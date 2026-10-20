// Owner: R3 (roles.md).
// Mock escrow (architecture §24.13): the same signature checks (viem recovery) and the same
// rules as PrepaidEscrow (§24.3), over mockbank.escrow_plans. It plays the contract, an outside
// party: it validates its own wire input and never imports server-side verification code.
//
// Money rules (G9/G10): no function takes a recipient. Money leaves a plan only to the plan's
// merchant (one unitPrice per two-signature redeem, or the voluntary-exit fee) or to the plan's
// owner (exits). Every payout is recorded in mockbank.escrow_payouts.
//
// Differences from the chain: no token ledger (the permit is accepted but not verified; the
// plan balance carries the money), and the caller of exitWithAttestation is self-declared
// (there is no msg.sender). Ids are `mock:<uuid>` instead of transaction hashes.

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { recoverTypedDataAddress, type Hex, type TypedDataDomain } from "viem";
import { z } from "zod";
import {
  MAX_ATTESTATION_AGE_SECONDS,
  MAX_CANCEL_FEE_BPS,
  OFFER_TYPES,
  PURCHASE_AUTH_TYPES,
  REDEEM_TYPES,
  VOLUNTARY_EXIT_TYPES,
  escrowDomainFromEnv,
  offerHash,
  purchaseAuthDigest,
  toOfferMessage,
  toPurchaseAuthMessage,
  toRedeemMessage,
  toVoluntaryExitMessage,
} from "@/src/server/chain/types";
import { ATTESTATION_PRIMARY_TYPE, ATTESTATION_TYPES, toAttestationMessage } from "@/src/sim/registry/eip712";
import { getMockbankPool } from "./db";
import { MockbankError, idempotent, type MbResponse } from "./bank";

// ---- Wire validation (outside input) ----------------------------------------------------

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const Address = z.string().regex(ADDRESS_RE);
const Bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const Signature = z.string().regex(/^0x[0-9a-fA-F]{1,512}$/);
const uint = (bits: number) => z.number().int().min(0).max(Math.min(Number.MAX_SAFE_INTEGER, 2 ** bits - 1));
const Uint256String = z
  .string()
  .regex(/^\d{1,78}$/)
  .refine((s) => BigInt(s) < BigInt(2) ** BigInt(256));

const OfferWire = z.object({
  merchant: Address,
  unitPrice: uint(128),
  units: uint(32),
  cancelFeeBps: uint(16),
  expiresAt: uint(64),
  nonce: Uint256String,
});
const PurchaseAuthWire = z.object({ offerHash: Bytes32, consumer: Address, agent: Address, deadline: uint(64) });
const PurchaseWire = z.object({
  offer: OfferWire,
  merchantSig: Signature,
  auth: PurchaseAuthWire,
  consumerSig: Signature,
  permit: z.unknown().optional(),
});
const RedeemWire = z.object({ sessionNo: uint(32), deadline: uint(64), consumerSig: Signature, merchantSig: Signature });
const AttestationWire = z.object({
  merchant: Address,
  kind: uint(8),
  caseRef: Bytes32,
  issuedAt: uint(64),
  expiresAt: uint(64),
  signature: Signature,
});
const VoluntaryExitWire = z.object({ deadline: uint(64).optional(), consumerSig: Signature.optional() });

function parse<T>(schema: z.ZodType<T>, v: unknown): T {
  const r = schema.safeParse(v);
  if (!r.success) throw new MockbankError(400, "invalid_request");
  return r.data;
}

// ---- Helpers ----------------------------------------------------------------------------

/** Postgres bigint (fen) upper bound; the chain uses uint256 and cannot overflow here. */
const PG_BIGINT_MAX = BigInt("9223372036854775807");

const sameAddress = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

const isZeroAddress = (a: string | null | undefined) => !a || /^0x0{40}$/i.test(a);

/** Recovered signer, or null for a malformed signature (the contract's ECDSA.recover reverts). */
async function recover(args: Parameters<typeof recoverTypedDataAddress>[0]): Promise<string | null> {
  try {
    return await recoverTypedDataAddress(args);
  } catch {
    return null;
  }
}

/** Block timestamp equivalent: read once per call. */
const nowSeconds = () => Math.floor(Date.now() / 1000);

const mockTx = () => `mock:${randomUUID()}`;

type PlanRow = {
  chain_plan_id: string;
  owner: string;
  merchant: string;
  agent: string | null;
  unit_price: string;
  units_total: number;
  units_redeemed: number;
  cancel_fee_bps: number;
  status: string;
  balance: string;
};

async function lockPlan(tx: PoolClient, chainPlanId: string): Promise<PlanRow> {
  const r = await tx.query<PlanRow>(
    `select chain_plan_id::text as chain_plan_id, owner, merchant, agent, unit_price::text as unit_price, units_total,
            units_redeemed, cancel_fee_bps, status, balance::text as balance
       from mockbank.escrow_plans where chain_plan_id = $1 for update`,
    [chainPlanId],
  );
  const p = r.rows[0];
  if (!p) throw new MockbankError(404, "plan_not_found");
  if (p.status !== "active") throw new MockbankError(409, "plan_not_active");
  return p;
}

async function payout(
  tx: PoolClient,
  p: PlanRow,
  to: "merchant" | "consumer",
  amount: bigint,
  reason: "redeem" | "exit_attested" | "exit_voluntary_refund" | "exit_voluntary_fee",
  txId: string,
) {
  if (amount <= BigInt(0)) return;
  // The destination is the plan's own merchant or owner, never an input.
  const toAddress = to === "merchant" ? p.merchant : p.owner;
  await tx.query(
    `insert into mockbank.escrow_payouts (chain_plan_id, to_address, role, amount, reason, tx_id)
     values ($1, $2, $3, $4, $5, $6)`,
    [p.chain_plan_id, toAddress, to, amount.toString(), reason, txId],
  );
}

// ---- Reads ------------------------------------------------------------------------------

export async function getEscrowPlan(chainPlanId: string) {
  const r = await getMockbankPool().query(
    `select chain_plan_id::text as chain_plan_id, owner, merchant, agent, unit_price::int as unit_price, units_total,
            units_redeemed, cancel_fee_bps, status, balance::bigint::text as balance
       from mockbank.escrow_plans where chain_plan_id = $1`,
    [chainPlanId],
  );
  if (!r.rowCount) throw new MockbankError(404, "plan_not_found");
  return r.rows[0];
}

// ---- purchaseWithPermit -----------------------------------------------------------------

/** PrepaidEscrow.purchaseWithPermit: a new plan owned by the consumer who signed `auth`. */
export function escrowPurchase(input: unknown, idempotencyKey: string): Promise<MbResponse> {
  return idempotent(idempotencyKey, "escrow_purchase", async (tx) => {
    const { offer, merchantSig, auth, consumerSig } = parse(PurchaseWire, input);
    const now = nowSeconds();
    const domain = escrowDomainFromEnv();
    if (now > offer.expiresAt || now > auth.deadline) throw new MockbankError(422, "expired");
    if (offer.units <= 0 || offer.unitPrice <= 0 || offer.cancelFeeBps > MAX_CANCEL_FEE_BPS) {
      throw new MockbankError(422, "invalid_terms");
    }
    const total = BigInt(offer.unitPrice) * BigInt(offer.units);
    if (total > PG_BIGINT_MAX) throw new MockbankError(422, "invalid_terms");

    const oHash = offerHash(domain, offer);
    const merchantSigner = await recover({
      domain,
      types: OFFER_TYPES,
      primaryType: "Offer",
      message: toOfferMessage(offer),
      signature: merchantSig as Hex,
    });
    if (!sameAddress(merchantSigner, offer.merchant)) throw new MockbankError(422, "merchant_signature_invalid");
    if (auth.offerHash.toLowerCase() !== oHash.toLowerCase()) throw new MockbankError(422, "offer_hash_mismatch");
    const consumerSigner = await recover({
      domain,
      types: PURCHASE_AUTH_TYPES,
      primaryType: "PurchaseAuth",
      message: toPurchaseAuthMessage(auth),
      signature: consumerSig as Hex,
    });
    if (!sameAddress(consumerSigner, auth.consumer)) throw new MockbankError(422, "consumer_signature_invalid");

    const digest = purchaseAuthDigest(domain, auth).toLowerCase();
    // Serialize purchases of the same authorization (different idempotency keys) on the digest.
    await tx.query("select pg_advisory_xact_lock(hashtext('mb:escrow:auth:' || $1))", [digest]);
    const used = await tx.query("select 1 from mockbank.escrow_auth_used where digest = $1", [digest]);
    if (used.rowCount) throw new MockbankError(422, "auth_used");

    const txId = mockTx();
    const id = await tx.query<{ id: string }>("select nextval('mockbank.escrow_plan_id_seq')::text as id");
    const chainPlanId = id.rows[0].id;
    await tx.query(
      `insert into mockbank.escrow_plans (chain_plan_id, owner, merchant, agent, unit_price, units_total, units_redeemed,
         cancel_fee_bps, status, balance, offer_hash, purchase_tx)
       values ($1, $2, $3, $4, $5, $6, 0, $7, 'active', $8, $9, $10)`,
      [
        chainPlanId,
        auth.consumer,
        offer.merchant,
        isZeroAddress(auth.agent) ? null : auth.agent,
        offer.unitPrice,
        offer.units,
        offer.cancelFeeBps,
        total.toString(),
        oHash.toLowerCase(),
        txId,
      ],
    );
    await tx.query("insert into mockbank.escrow_auth_used (digest, chain_plan_id) values ($1, $2)", [digest, chainPlanId]);
    const body = {
      status: "confirmed",
      txHash: txId,
      chainPlanId,
      event: "Purchased",
      consumer: auth.consumer,
      merchant: offer.merchant,
      amount: total.toString(),
    };
    return { status: 200, body };
  });
}

// ---- redeem -----------------------------------------------------------------------------

/** PrepaidEscrow.redeem: both the owner and the merchant sign the same session. */
export function escrowRedeem(chainPlanId: string, input: unknown, idempotencyKey: string): Promise<MbResponse> {
  return idempotent(idempotencyKey, "escrow_redeem", async (tx) => {
    const r = parse(RedeemWire, input);
    const now = nowSeconds();
    const domain = escrowDomainFromEnv();
    const p = await lockPlan(tx, chainPlanId);
    if (now > r.deadline) throw new MockbankError(422, "expired");
    if (r.sessionNo !== p.units_redeemed + 1) throw new MockbankError(422, "wrong_session");
    const args = {
      domain,
      types: REDEEM_TYPES,
      primaryType: "Redeem",
      message: toRedeemMessage({ planId: p.chain_plan_id, sessionNo: r.sessionNo, deadline: r.deadline }),
    } as const;
    if (!sameAddress(await recover({ ...args, signature: r.consumerSig as Hex }), p.owner)) {
      throw new MockbankError(422, "consumer_signature_invalid");
    }
    if (!sameAddress(await recover({ ...args, signature: r.merchantSig as Hex }), p.merchant)) {
      throw new MockbankError(422, "merchant_signature_invalid");
    }
    const unitPrice = BigInt(p.unit_price);
    if (BigInt(p.balance) < unitPrice) throw new MockbankError(409, "insufficient_escrow_balance");

    const txId = mockTx();
    const completed = r.sessionNo === p.units_total;
    await tx.query(
      `update mockbank.escrow_plans set units_redeemed = $2, balance = balance - $3, status = $4 where chain_plan_id = $1`,
      [p.chain_plan_id, r.sessionNo, unitPrice.toString(), completed ? "completed" : "active"],
    );
    await tx.query("insert into mockbank.escrow_sessions (chain_plan_id, session_no, tx_id) values ($1, $2, $3)", [
      p.chain_plan_id,
      r.sessionNo,
      txId,
    ]);
    await payout(tx, p, "merchant", unitPrice, "redeem", txId);
    const body = {
      status: "confirmed",
      txHash: txId,
      chainPlanId: p.chain_plan_id,
      event: "Redeemed",
      sessionNo: r.sessionNo,
      amount: unitPrice.toString(),
      paidTo: p.merchant,
      completed,
    };
    return { status: 200, body };
  });
}

// ---- exitWithAttestation ----------------------------------------------------------------

/**
 * PrepaidEscrow.exitWithAttestation: the full unused balance goes to the plan owner, only for
 * an attestation signed by the oracle (ORACLE_ADDRESS, read at call time like an immutable).
 */
export function escrowExitAttested(chainPlanId: string, input: Record<string, unknown> | undefined, idempotencyKey: string): Promise<MbResponse> {
  return idempotent(idempotencyKey, "escrow_exit_attested", async (tx) => {
    const caller = typeof input?.caller === "string" ? input.caller : "";
    if (input?.attestation === undefined) throw new MockbankError(400, "attestation_required");
    const att = parse(AttestationWire, input.attestation);
    const now = nowSeconds();
    const domain: TypedDataDomain = escrowDomainFromEnv();
    const p = await lockPlan(tx, chainPlanId);
    const callerOk = sameAddress(caller, p.owner) || (!isZeroAddress(p.agent) && sameAddress(caller, p.agent));
    if (!callerOk) throw new MockbankError(403, "caller_not_owner_or_agent");
    if (!sameAddress(att.merchant, p.merchant)) throw new MockbankError(422, "attestation_merchant_mismatch");
    if (att.kind !== 1 && att.kind !== 2) throw new MockbankError(422, "attestation_kind_invalid");
    if (!(att.issuedAt <= now && now <= att.expiresAt)) throw new MockbankError(422, "attestation_window");
    if (now - att.issuedAt > MAX_ATTESTATION_AGE_SECONDS) throw new MockbankError(422, "attestation_stale");
    const oracle = process.env.ORACLE_ADDRESS ?? "";
    if (!ADDRESS_RE.test(oracle)) throw new MockbankError(422, "oracle_not_configured");
    const signer = await recover({
      domain,
      types: ATTESTATION_TYPES,
      primaryType: ATTESTATION_PRIMARY_TYPE,
      message: toAttestationMessage({ ...att, kind: att.kind as 1 | 2 }),
      signature: att.signature as Hex,
    });
    if (!sameAddress(signer, oracle)) throw new MockbankError(422, "oracle_signature_invalid");

    const refund = BigInt(p.balance);
    const txId = mockTx();
    await tx.query("update mockbank.escrow_plans set status = 'exited_attested', balance = 0 where chain_plan_id = $1", [p.chain_plan_id]);
    await payout(tx, p, "consumer", refund, "exit_attested", txId);
    const body = {
      status: "confirmed",
      txHash: txId,
      chainPlanId: p.chain_plan_id,
      event: "ExitedAttested",
      refundTo: p.owner,
      refund: refund.toString(),
      fee: "0",
    };
    return { status: 200, body };
  });
}

// ---- exitVoluntaryBySig -----------------------------------------------------------------

/** PrepaidEscrow.exitVoluntaryBySig: the owner signs; fee to the merchant, the rest to the owner. */
export function escrowExitVoluntary(chainPlanId: string, input: unknown, idempotencyKey: string): Promise<MbResponse> {
  return idempotent(idempotencyKey, "escrow_exit_voluntary", async (tx) => {
    const v = parse(VoluntaryExitWire, input ?? {});
    const now = nowSeconds();
    const domain = escrowDomainFromEnv();
    const p = await lockPlan(tx, chainPlanId);
    if (!v.consumerSig || v.deadline === undefined) throw new MockbankError(422, "consumer_signature_required");
    if (now > v.deadline) throw new MockbankError(422, "expired");
    const signer = await recover({
      domain,
      types: VOLUNTARY_EXIT_TYPES,
      primaryType: "VoluntaryExit",
      message: toVoluntaryExitMessage({ planId: p.chain_plan_id, deadline: v.deadline }),
      signature: v.consumerSig as Hex,
    });
    if (!sameAddress(signer, p.owner)) throw new MockbankError(422, "consumer_signature_invalid");

    const remaining = BigInt(p.balance);
    const fee = (remaining * BigInt(p.cancel_fee_bps)) / BigInt(10_000);
    const refund = remaining - fee;
    const txId = mockTx();
    await tx.query("update mockbank.escrow_plans set status = 'exited_voluntary', balance = 0 where chain_plan_id = $1", [p.chain_plan_id]);
    await payout(tx, p, "consumer", refund, "exit_voluntary_refund", txId);
    await payout(tx, p, "merchant", fee, "exit_voluntary_fee", txId);
    const body = {
      status: "confirmed",
      txHash: txId,
      chainPlanId: p.chain_plan_id,
      event: "ExitedVoluntary",
      refundTo: p.owner,
      refund: refund.toString(),
      fee: fee.toString(),
    };
    return { status: 200, body };
  });
}
