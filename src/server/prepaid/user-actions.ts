// Owner: R2 (roles.md). User-initiated prepaid actions (architecture §8.2, §24.10; R2-06).
// Purchase, check-in (redeem) and voluntary exit are started by the user, signed in the browser
// with the consumer key, and run through the SAME executor as agent actions: a plan with trigger
// `user_action`, one `actions` row with actor `user`, then ActionExecutor.run. This module never
// moves money and never trusts the browser: it stores the signed payload next to the action (out
// of the args, so the action hash and the agent's surface are unchanged) and the executor
// re-verifies every signature in phase B before anything reaches the escrow. Never log signatures.

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { actionHash } from "@/src/core/mandate/canonical";
import type { ExecResult } from "@/src/core/types";
import { appendAudit } from "@/src/server/audit";
import { withUserTx } from "@/src/server/db/pool";
import { getExecutor } from "@/src/server/executor";

export type UserPrepaidTool = "prepaid_purchase" | "prepaid_redeem" | "prepaid_exit_voluntary";

export class UserActionError extends Error {
  constructor(readonly code: "invalid" | "not_found" | "no_wallet" | "no_mandate" | "plan_not_active") {
    super(code);
  }
}

const Hex65 = z.string().regex(/^0x[0-9a-fA-F]{130}$/);
const Addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const Bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const U = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const DecStr = z.string().regex(/^\d{1,78}$/);

const OfferWire = z.object({ merchant: Addr, unitPrice: U, units: U, cancelFeeBps: U, expiresAt: U, nonce: DecStr }).strict();
const AuthWire = z.object({ offerHash: Bytes32, consumer: Addr, agent: Addr, deadline: U }).strict();
const PermitWire = z.object({ value: DecStr, deadline: DecStr, v: z.number().int().min(0).max(255), r: Bytes32, s: Bytes32 }).strict();

export const PurchaseBody = z
  .object({ offerId: z.uuid(), offer: OfferWire, merchantSig: Hex65, auth: AuthWire, consumerSig: Hex65, permit: PermitWire.optional() })
  .strict();
export const CheckinBody = z.object({ sessionNo: z.number().int().positive(), deadline: U, consumerSig: Hex65, merchantSig: Hex65 }).strict();
export const ExitBody = z.object({ deadline: U, consumerSig: Hex65 }).strict();

export type PurchaseInput = z.infer<typeof PurchaseBody>;
export type CheckinInput = z.infer<typeof CheckinBody>;
export type ExitInput = z.infer<typeof ExitBody>;

export type UserActionResponse = {
  actionId: string;
  planId: string;
  status: ExecResult["status"];
  decision: "allow" | "require_confirm" | "deny" | null;
  ruleIds: string[];
  tx: { hash: string; simulated: boolean } | null;
  error?: string;
};

/** Registers the browser-generated consumer address (POST /api/prepaid/wallet). Address only. */
export function registerWallet(userId: string, address: string): Promise<{ address: string; changed: boolean }> {
  if (!Addr.safeParse(address).success) throw new UserActionError("invalid");
  return withUserTx(userId, async (tx) => {
    const cur = await tx.query("select address from public.wallets where user_id = $1 and kind = 'consumer_browser' for update", [userId]);
    const before = cur.rows[0]?.address as string | undefined;
    if (before && before.toLowerCase() === address.toLowerCase()) return { address: before, changed: false };
    // Changing the key never moves a plan: plans stay bound on the escrow to the address that bought them.
    await tx.query(
      `insert into public.wallets (user_id, address, kind) values ($1, $2, 'consumer_browser')
       on conflict (user_id, kind) do update set address = excluded.address`,
      [userId, address],
    );
    await appendAudit(tx, userId, { actor: "user", eventType: "wallet.registered", data: { address, previous: before ?? null } });
    return { address, changed: true };
  });
}

/** Creates the plan + action + stored signature, then runs the action through the executor. */
async function startUserAction(userId: string, tool: UserPrepaidTool, args: Record<string, unknown>, payload: unknown): Promise<UserActionResponse> {
  const { planId, actionId } = await withUserTx(userId, async (tx) => {
    const m = await tx.query("select version from public.mandates where user_id = $1 and status = 'active'", [userId]);
    if (!m.rowCount) throw new UserActionError("no_mandate");
    const w = await tx.query("select 1 from public.wallets where user_id = $1 and kind = 'consumer_browser'", [userId]);
    if (!w.rowCount) throw new UserActionError("no_wallet");

    const p = await tx.query(
      `insert into public.plans (user_id, trigger, subject_id, status) values ($1, 'user_action', $2, 'running') returning id`,
      [userId, randomUUID()], // subject is unique per request: user actions never collide in one_running_plan
    );
    const plan = p.rows[0].id as string;
    const a = await tx.query(
      `insert into public.actions (plan_id, user_id, idx, tool, actor, args_json, args_hash, mandate_version, idempotency_key, status)
       values ($1, $2, 0, $3, 'user', $4, $5, $6, $7, 'planned') returning id`,
      [plan, userId, tool, JSON.stringify(args), actionHash(tool, args), m.rows[0].version, `user:${tool}:${plan}`],
    );
    const action = a.rows[0].id as string;
    await tx.query("insert into public.prepaid_action_signatures (action_id, user_id, tool, payload) values ($1, $2, $3, $4)", [
      action,
      userId,
      tool,
      JSON.stringify(payload),
    ]);
    await appendAudit(tx, userId, { actor: "user", eventType: "user_action.created", data: { planId: plan, actionId: action, tool } });
    return { planId: plan, actionId: action };
  });

  const res = await getExecutor().run(actionId, userId);
  await withUserTx(userId, (tx) =>
    tx.query("update public.plans set status = $2 where id = $1 and user_id = $3", [planId, res.status === "awaiting_approval" ? "paused" : "done", userId]),
  );
  const result = (res.result ?? null) as { txHash?: string; simulated?: boolean } | null;
  return {
    actionId,
    planId,
    status: res.status,
    decision: res.gate?.decision ?? null,
    ruleIds: res.gate?.ruleIds ?? [],
    tx: result?.txHash ? { hash: result.txHash, simulated: result.simulated ?? result.txHash.startsWith("mock:") } : null,
    ...(res.error ? { error: res.error } : {}),
  };
}

export async function purchase(userId: string, input: PurchaseInput): Promise<UserActionResponse> {
  const { offerId, ...payload } = input;
  return startUserAction(userId, "prepaid_purchase", { offer_id: offerId }, payload);
}

async function ownedPlan(userId: string, planId: string) {
  return withUserTx(userId, async (tx) => {
    const r = await tx.query("select id, status, units_redeemed from public.prepaid_plans where id = $1 and user_id = $2", [planId, userId]);
    return r.rows[0] as { id: string; status: string; units_redeemed: number } | undefined;
  });
}

export async function checkin(userId: string, planId: string, input: CheckinInput): Promise<UserActionResponse> {
  const plan = await ownedPlan(userId, planId);
  if (!plan) throw new UserActionError("not_found");
  if (plan.status !== "active") throw new UserActionError("plan_not_active");
  const { sessionNo, ...payload } = input;
  return startUserAction(userId, "prepaid_redeem", { plan_id: planId, session_no: sessionNo }, { sessionNo, ...payload });
}

export async function exitVoluntary(userId: string, planId: string, input: ExitInput): Promise<UserActionResponse> {
  const plan = await ownedPlan(userId, planId);
  if (!plan) throw new UserActionError("not_found");
  if (plan.status !== "active") throw new UserActionError("plan_not_active");
  return startUserAction(userId, "prepaid_exit_voluntary", { plan_id: planId }, input);
}
