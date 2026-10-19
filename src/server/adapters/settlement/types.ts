// Owner: R2 (interfaces), R3 (implementations) (roles.md §4). Minimal version by R1; extend, don't duplicate.
// Settlement and escrow adapter interfaces (architecture §8.4, §24.5). Imported ONLY by
// src/server/executor/** (ESLint, G1). No method takes a destination or recipient.

import type { OfferJson, PurchaseAuthJson } from "@/src/server/chain/types";
import type { AttestationJson } from "@/src/sim/registry/eip712";

export type SettlementOpts = {
  idempotencyKey: string;
  /** The paying customer at the bank (= app user id). The payer, never the payee. */
  customerId: string;
};

export type SettlementResult = { status: "succeeded"; reference: string; raw: unknown };

/** Thrown by adapters. `definitive` = the call certainly had no effect (4xx); else outcome unknown. */
export class SettlementError extends Error {
  constructor(
    readonly code: string,
    readonly definitive: boolean,
    readonly raw?: unknown,
  ) {
    super(code);
  }
}

export interface SettlementAdapter {
  payBill(a: { billId: string; billerId: string; amount: number; currency: string }, o: SettlementOpts): Promise<SettlementResult>;
  cancelSubscription(a: { subscriptionId: string }, o: SettlementOpts): Promise<SettlementResult>;
  transferInternal(a: { amount: number }, o: SettlementOpts): Promise<SettlementResult>; // [R2]
  lookup(idempotencyKey: string): Promise<SettlementResult | null>;
}

export type ChainResult =
  | { status: "confirmed"; txHash: string; blockNumber: bigint | null; events: unknown[] }
  | { status: "reverted"; txHash: string | null; reason: string }
  | { status: "pending"; txHash: string };

export type EscrowSendOpts = { actionId: string; idempotencyKey: string };

/** Contract (or mock escrow) plan state, read at decision time. Amounts in fen. */
export type EscrowPlanState = {
  chainPlanId: string;
  owner: string;
  merchant: string;
  agent: string | null;
  status: "active" | "completed" | "exited_attested" | "exited_voluntary";
  unitPrice: number;
  unitsTotal: number;
  unitsRedeemed: number;
};

/** Signed EIP-712 data the escrow verifies itself (architecture §24.3). Never a recipient. */
export type EscrowPurchaseArgs = {
  offer: OfferJson;
  merchantSig: string;
  auth: PurchaseAuthJson;
  consumerSig: string;
  /** ERC-2612 permit for the token pull; the mock escrow has no token and ignores it. */
  permit?: unknown;
};

export type EscrowRedeemArgs = { chainPlanId: string; sessionNo: number; deadline: number; consumerSig: string; merchantSig: string };

/**
 * EscrowAdapter (architecture §24.5). purchase and redeem are relayed for the parties that
 * signed them; exitWithAttestation is the only call made with the agent key.
 */
export interface EscrowAdapter {
  readPlan(chainPlanId: string): Promise<EscrowPlanState | null>;
  purchase(a: EscrowPurchaseArgs, o: EscrowSendOpts): Promise<ChainResult>;
  redeem(a: EscrowRedeemArgs, o: EscrowSendOpts): Promise<ChainResult>;
  /** `attestation` is the oracle-signed record the decision used (`attestationId`). */
  exitWithAttestation(a: { chainPlanId: string; attestationId: string; attestation: AttestationJson }, o: EscrowSendOpts): Promise<ChainResult>;
  /** Without the owner's VoluntaryExit signature the escrow reverts. */
  exitVoluntary(a: { chainPlanId: string; deadline?: number; consumerSig?: string }, o: EscrowSendOpts): Promise<ChainResult>;
  lookup(idempotencyKey: string): Promise<ChainResult | null>;
}
