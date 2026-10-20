// Owner: R3 (roles.md).
// Merchant simulator check-in (architecture §24.3 redeem, §24.7): the gym signs Redeem for the
// plan's next session. The consumer co-signs separately; the escrow needs both signatures.
// The plan is read from the escrow itself: the mock escrow over HTTP, or PrepaidEscrow on chain
// when REINS_ESCROW=chain. The simulator is an outside party and imports no executor or adapter code.
import { chainConfigFromEnv, publicClientFor, readChainPlan } from "@/src/server/chain/client";
import { REDEEM_TYPES, escrowDomainFromEnv, toRedeemMessage, type RedeemJson } from "@/src/server/chain/types";
import { merchantAccount } from "./keys";

const CHECKIN_VALIDITY_S = 600;

/** The fields of an escrow plan the check-in needs (mock bank GET /escrow/plans/:id). */
export type EscrowPlanView = { chain_plan_id: string; merchant: string; status: string; units_redeemed: number };

export type PlanReader = (planId: string) => Promise<EscrowPlanView | null>;

export class CheckinError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = "CheckinError";
  }
}

export type SignedCheckin = RedeemJson & { merchantSig: `0x${string}`; merchant: string; simulated: true };

/** Default reader: the mock bank's escrow plan endpoint. Returns null on 404. */
export const readPlanFromMockbank: PlanReader = async (planId) => {
  const base = process.env.MOCKBANK_URL;
  const key = process.env.MOCKBANK_API_KEY;
  if (!base || !key) throw new CheckinError(503, "escrow_not_configured");
  const res = await fetch(`${base.replace(/\/$/, "")}/escrow/plans/${encodeURIComponent(planId)}`, {
    headers: { "x-api-key": key },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new CheckinError(502, "escrow_unavailable");
  const body = (await res.json()) as { plan?: EscrowPlanView };
  return body.plan ?? null;
};

/** Reader for REINS_ESCROW=chain: the contract's own plan state. Returns null for an unknown plan. */
export const readPlanFromChain: PlanReader = async (planId) => {
  const chain = chainConfigFromEnv();
  if (!chain) throw new CheckinError(503, "escrow_not_configured");
  if (!/^\d{1,78}$/.test(planId)) return null;
  let plan;
  try {
    plan = await readChainPlan(publicClientFor(chain), chain.escrowAddress, BigInt(planId));
  } catch {
    throw new CheckinError(502, "escrow_unavailable");
  }
  return plan && { chain_plan_id: planId, merchant: plan.merchant, status: plan.status, units_redeemed: plan.redeemed };
};

/** The reader for the configured escrow (chain or mock). */
export function defaultPlanReader(env: Record<string, string | undefined> = process.env): PlanReader {
  return env.REINS_ESCROW === "chain" ? readPlanFromChain : readPlanFromMockbank;
}

/** Signs Redeem{planId, sessionNo: redeemed + 1, deadline: now + 10 min} for a plan of this merchant. */
export async function signCheckin(
  planId: string,
  now: Date = new Date(),
  readPlan: PlanReader = defaultPlanReader(),
  env: Record<string, string | undefined> = process.env,
): Promise<SignedCheckin> {
  const account = merchantAccount(env);
  const plan = await readPlan(planId);
  if (!plan) throw new CheckinError(404, "plan_not_found");
  if (plan.status !== "active") throw new CheckinError(409, "plan_not_active");
  if (plan.merchant.toLowerCase() !== account.address.toLowerCase()) throw new CheckinError(409, "not_this_merchant");

  const redeem: RedeemJson = {
    planId,
    sessionNo: Number(plan.units_redeemed) + 1,
    deadline: Math.floor(now.getTime() / 1000) + CHECKIN_VALIDITY_S,
  };
  const merchantSig = await account.signTypedData({
    domain: escrowDomainFromEnv(env),
    types: REDEEM_TYPES,
    primaryType: "Redeem",
    message: toRedeemMessage(redeem),
  });
  return { ...redeem, merchantSig, merchant: account.address, simulated: true };
}
