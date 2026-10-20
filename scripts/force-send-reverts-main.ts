// Body of scripts/force-send-reverts.ts (kept separate so the resolve hook is registered before
// any "@/" import is evaluated). Also imported by tests/chain/force-send.test.ts, which runs the
// same three attacks on a private anvil.
//
// Three attack transactions against one active plan, sent through ChainEscrowAdapter with
// force-send on (architecture §24.5, PRD §20.3 arm A on the contract layer). Each is mined as a
// reverted transaction and recorded in chain_txs with its decoded reason:
//   1. exitWithAttestation with an attestation signed by a key that is not the oracle (T19)
//   2. a check-in carrying only the merchant's signature (T22)
//   3. a check-in for a session out of order (T22)
// Never moves money: every call is one the contract rejects.

import { randomUUID } from "node:crypto";
import { keccak256, toHex, type Hex, type TypedDataDomain } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { actionHash } from "@/src/core/mandate/canonical";
import { REDEEM_TYPES } from "@/src/server/chain/eip712";
import { withUserTx } from "@/src/server/db/pool";
import { chainEscrowFromEnv, type ChainEscrowAdapter } from "@/src/server/executor";
import { attestationDomainFromEnv, ATTESTATION_PRIMARY_TYPE, ATTESTATION_TYPES, toAttestationMessage } from "@/src/sim/registry/eip712";
import { evalForceSendReverts } from "@/src/server/platform/eval-guard";

export type RevertEvidence = { name: string; actionId: string; status: string; txHash: string | null; reason: string | null };

export type EvidenceInput = {
  adapter: Pick<ChainEscrowAdapter, "exitWithAttestation" | "redeem" | "readPlan">;
  userId: string;
  chainPlanId: string;
  /** EIP-712 domain of the escrow (attestations and check-ins). */
  domain: TypedDataDomain;
  /** The merchant's key, when the caller has it (tests, the merchant simulator). Otherwise a throwaway key signs. */
  merchantKey?: Hex;
};

/** A plan and one action row, so the transaction is recorded against a real action (chain_txs FK). */
async function evidenceAction(userId: string, tool: string, args: Record<string, unknown>): Promise<{ id: string; key: string }> {
  return withUserTx(userId, async (tx) => {
    const plan = await tx.query<{ id: string }>(
      "insert into public.plans (user_id, trigger, subject_id, status) values ($1, 'user_action', $2, 'done') returning id",
      [userId, randomUUID()],
    );
    const key = `eval-force-send:${randomUUID()}`;
    const a = await tx.query<{ id: string }>(
      `insert into public.actions (plan_id, user_id, idx, tool, actor, args_json, args_hash, mandate_version, idempotency_key)
       values ($1, $2, 0, $3, 'agent', $4, $5, 3, $6) returning id`,
      [plan.rows[0].id, userId, tool, JSON.stringify(args), actionHash(tool, args), key],
    );
    return { id: a.rows[0].id, key };
  });
}

export async function sendRevertEvidence(input: EvidenceInput): Promise<RevertEvidence[]> {
  const { adapter, userId, chainPlanId, domain } = input;
  const plan = await adapter.readPlan(chainPlanId);
  if (!plan || plan.status !== "active") throw new Error(`plan ${chainPlanId} is not active on chain`);
  const nowS = Math.floor(Date.now() / 1000);
  const out: RevertEvidence[] = [];
  const record = (name: string, actionId: string, r: { status: string; txHash: string | null; reason?: string }) =>
    out.push({ name, actionId, status: r.status, txHash: r.txHash, reason: r.reason ?? null });

  // 1. Attestation about this plan's merchant, fresh and of an exit kind, but not signed by the oracle.
  const forger = privateKeyToAccount(generatePrivateKey());
  const wire = {
    merchant: plan.merchant,
    kind: 1,
    caseRef: keccak256(toHex(`eval:forged:${randomUUID()}`)),
    issuedAt: nowS - 600,
    expiresAt: nowS + 30 * 86_400,
  };
  const signature = await forger.signTypedData({ domain, types: ATTESTATION_TYPES, primaryType: ATTESTATION_PRIMARY_TYPE, message: toAttestationMessage(wire) });
  const exit = await evidenceAction(userId, "prepaid_exit", { plan_id: `chain:${chainPlanId}` });
  record(
    "forged_attestation_exit",
    exit.id,
    await adapter.exitWithAttestation(
      { chainPlanId, attestationId: randomUUID(), attestation: { ...wire, signature, simulated: true } as never },
      { actionId: exit.id, idempotencyKey: exit.key, userId },
    ),
  );

  // 2 and 3. Check-ins. The consumer's signature is never available here: a throwaway key stands in.
  const nextSession = plan.unitsRedeemed + 1;
  const sign = async (key: Hex, sessionNo: number, deadline: bigint) =>
    privateKeyToAccount(key).signTypedData({ domain, types: REDEEM_TYPES, primaryType: "Redeem", message: { planId: BigInt(chainPlanId), sessionNo, deadline } });
  const deadline = BigInt(nowS + 600);
  const merchantKey = input.merchantKey ?? generatePrivateKey();
  const notConsumer = generatePrivateKey();

  const merchantOnly = await evidenceAction(userId, "prepaid_redeem", { plan_id: `chain:${chainPlanId}`, session_no: nextSession });
  record(
    "merchant_only_checkin",
    merchantOnly.id,
    await adapter.redeem(
      {
        chainPlanId,
        sessionNo: nextSession,
        deadline: Number(deadline),
        consumerSig: await sign(notConsumer, nextSession, deadline),
        merchantSig: await sign(merchantKey, nextSession, deadline),
      },
      { actionId: merchantOnly.id, idempotencyKey: merchantOnly.key, userId },
    ),
  );

  const skip = nextSession + 1;
  const outOfOrder = await evidenceAction(userId, "prepaid_redeem", { plan_id: `chain:${chainPlanId}`, session_no: skip });
  record(
    "out_of_order_checkin",
    outOfOrder.id,
    await adapter.redeem(
      { chainPlanId, sessionNo: skip, deadline: Number(deadline), consumerSig: await sign(notConsumer, skip, deadline), merchantSig: await sign(merchantKey, skip, deadline) },
      { actionId: outOfOrder.id, idempotencyKey: outOfOrder.key, userId },
    ),
  );
  return out;
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** CLI: see scripts/force-send-reverts.ts. */
export async function main(argv: string[]) {
  const chainPlanId = arg(argv, "--plan");
  const userId = arg(argv, "--user");
  if (!chainPlanId || !/^\d+$/.test(chainPlanId) || !userId) throw new Error("usage: --plan <chainPlanId> --user <userId> --confirm");
  if (!argv.includes("--confirm")) throw new Error("This sends three real (reverting) transactions and spends test gas. Re-run with --confirm.");
  if (!evalForceSendReverts(process.env)) throw new Error("Set EVAL_FORCE_SEND_REVERTS=1 for this run.");
  const adapter = chainEscrowFromEnv();
  const results = await sendRevertEvidence({ adapter, userId, chainPlanId, domain: attestationDomainFromEnv() });
  for (const r of results) console.log(`${r.name}: ${r.status} ${r.reason ?? ""} tx ${r.txHash ?? "(none)"}`);
  const ok = results.every((r) => r.status === "reverted" && r.txHash);
  if (!ok) process.exitCode = 1;
  const { getPool, setPool } = await import("@/src/server/db/pool");
  await getPool().end();
  setPool(null);
}

