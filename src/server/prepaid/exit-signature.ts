// Owner: R3 (roles.md). Second review: R2.
// The owner's EIP-712 VoluntaryExit(uint256 planId,uint64 deadline) signature for a
// prepaid_exit action (architecture §24.3, §24.5). The browser signs with the consumer key;
// the server only ever sees and stores the signature and its deadline (G9/G10). It lives in
// public.prepaid_exit_signatures, never in the action args, so the agent cannot supply or
// change it (G2, G6). The executor re-verifies it against the escrow plan's owner before it
// may influence a decision or reach the escrow. Never log the signature.

import type { PoolClient } from "pg";
import { recoverTypedDataAddress, type Hex } from "viem";
import { z } from "zod";
import { appendAudit } from "@/src/server/audit";
import { VOLUNTARY_EXIT_TYPES, escrowDomainFromEnv, toVoluntaryExitMessage } from "@/src/server/chain/types";
import { withUserTx } from "@/src/server/db/pool";

export type VoluntaryExitSignature = { deadline: number; consumerSig: string };

export class ExitSignatureError extends Error {
  constructor(readonly code: "not_found" | "wrong_tool" | "action_not_open" | "invalid" | "expired" | "signature_invalid") {
    super(code);
  }
}

/** Statuses in which an action can still be decided (as in the executor's entry statuses). */
const OPEN_STATUSES = ["planned", "ready", "awaiting_approval"];

const SignatureInput = z
  .object({
    deadline: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    consumerSig: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
  })
  .strict();

/** Recovers the EIP-712 signer of a VoluntaryExit for `chainPlanId`; null when it cannot be parsed. */
export async function recoverVoluntaryExitSigner(chainPlanId: string, sig: VoluntaryExitSignature): Promise<string | null> {
  try {
    return await recoverTypedDataAddress({
      domain: escrowDomainFromEnv(),
      types: VOLUNTARY_EXIT_TYPES,
      primaryType: "VoluntaryExit",
      message: toVoluntaryExitMessage({ planId: chainPlanId, deadline: sig.deadline }),
      signature: sig.consumerSig as Hex,
    });
  } catch {
    return null;
  }
}

const sameAddress = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * The stored signature for `actionId`, only if it is unexpired at `nowSeconds` and recovers to
 * `owner` for `chainPlanId`. Runs in the caller's (user-scoped) transaction.
 */
export async function verifiedVoluntaryExitSignature(
  tx: PoolClient,
  actionId: string,
  ctx: { chainPlanId: string; owner: string; nowSeconds: number },
): Promise<VoluntaryExitSignature | null> {
  const r = await tx.query("select deadline::text as deadline, consumer_sig from public.prepaid_exit_signatures where action_id = $1", [actionId]);
  const row = r.rows[0] as { deadline: string; consumer_sig: string } | undefined;
  if (!row) return null;
  const sig = { deadline: Number(row.deadline), consumerSig: row.consumer_sig };
  if (!Number.isSafeInteger(sig.deadline) || sig.deadline <= ctx.nowSeconds) return null;
  const signer = await recoverVoluntaryExitSigner(ctx.chainPlanId, sig);
  return sameAddress(signer, ctx.owner) ? sig : null;
}

/**
 * Stores the owner's signature for their own open prepaid_exit action (session-scoped:
 * `userId` must come from the session). The signer must be the user's consumer_browser wallet
 * for the action's plan. Replaces an earlier signature for the same action.
 */
export async function recordVoluntaryExitSignature(
  userId: string,
  actionId: string,
  input: unknown,
): Promise<{ actionId: string; deadline: number }> {
  const parsed = SignatureInput.safeParse(input);
  if (!parsed.success) throw new ExitSignatureError("invalid");
  const sig = parsed.data;

  return withUserTx(userId, async (tx) => {
    const a = await tx.query("select tool, status, args_json from public.actions where id = $1 and user_id = $2 for update", [actionId, userId]);
    const action = a.rows[0] as { tool: string; status: string; args_json: Record<string, unknown> } | undefined;
    if (!action) throw new ExitSignatureError("not_found");
    if (action.tool !== "prepaid_exit") throw new ExitSignatureError("wrong_tool");
    if (!OPEN_STATUSES.includes(action.status)) throw new ExitSignatureError("action_not_open");

    const fresh = await tx.query("select $1::bigint > extract(epoch from now())::bigint as ok", [sig.deadline]);
    if (fresh.rows[0]?.ok !== true) throw new ExitSignatureError("expired");

    const planId = typeof action.args_json.plan_id === "string" ? action.args_json.plan_id : "";
    const owner = /^[0-9a-f-]{36}$/i.test(planId)
      ? (
          await tx.query(
            `select p.chain_plan_id::text as chain_plan_id, w.address
               from public.prepaid_plans p
               join public.wallets w on w.user_id = p.user_id and w.kind = 'consumer_browser'
              where p.id = $1 and p.user_id = $2`,
            [planId, userId],
          )
        ).rows[0]
      : undefined;
    if (!owner) throw new ExitSignatureError("signature_invalid");
    const signer = await recoverVoluntaryExitSigner(String(owner.chain_plan_id), sig);
    if (!sameAddress(signer, String(owner.address))) throw new ExitSignatureError("signature_invalid");

    await tx.query(
      `insert into public.prepaid_exit_signatures (action_id, user_id, deadline, consumer_sig)
       values ($1, $2, $3, $4)
       on conflict (action_id) do update set deadline = excluded.deadline, consumer_sig = excluded.consumer_sig, updated_at = now()`,
      [actionId, userId, sig.deadline, sig.consumerSig],
    );
    await appendAudit(tx, userId, { actor: "user", eventType: "prepaid.exit_signature_recorded", data: { actionId, deadline: sig.deadline } });
    return { actionId, deadline: sig.deadline };
  });
}
