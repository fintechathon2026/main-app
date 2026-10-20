// Owner: R3 (roles.md). Second reviewer: R2.
// ChainEscrowAdapter (PRD_PrepaidEscrow_Contract §7, architecture §24.5): sends PrepaidEscrow
// transactions from the relayer key (purchase, redeem, voluntary exit) and the agent key
// (exitWithAttestation only). Imported only by src/server/executor/** (ESLint, G1). This module
// is the only place that reads AGENT_PRIVATE_KEY and RELAYER_PRIVATE_KEY (lint rule, §7.8).
//
// Send path, exactly once per action (§7.4):
//   1. chain_txs row for the action exists -> re-broadcast the stored raw transaction (same hash)
//   2. simulate + estimate gas; a revert returns `reverted` and sends nothing
//   3. one user transaction: lock chain_nonces row, nonce = max(next, pending count), sign,
//      insert chain_txs (signed), advance next_nonce; any failure rolls back (no nonce gap)
//   4. broadcast; 5. wait for the receipt (timeout -> `pending`, never a second send)

import {
  BaseError,
  ContractFunctionRevertedError,
  encodeFunctionData,
  keccak256,
  parseEventLogs,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { z } from "zod";
import { withUserTx } from "@/src/server/db/pool";
import { PREPAID_ESCROW_ABI } from "@/src/server/chain/abi";
import { chainConfigFromEnv, publicClientFor, readChainPlan, type ChainConfig } from "@/src/server/chain/client";
import { toOfferMessage, toPurchaseAuthMessage } from "@/src/server/chain/types";
import type { ChainResult, EscrowAdapter, EscrowPlanState, EscrowSendOpts } from "../types";
import { SettlementError } from "../types";

type Sender = "relayer" | "agent";
type EscrowFunction = "purchaseWithPermit" | "redeem" | "exitWithAttestation" | "exitVoluntaryBySig";

/** Only exitWithAttestation may be sent by the agent key (AGENTS.md "Never"). */
const SENDER_OF: Record<EscrowFunction, Sender> = {
  purchaseWithPermit: "relayer",
  redeem: "relayer",
  exitVoluntaryBySig: "relayer",
  exitWithAttestation: "agent",
};

export type PermitSig = { value: bigint; deadline: bigint; v: number; r: Hex; s: Hex };

export interface ChainEscrowAdapter extends EscrowAdapter {
  readonly escrowAddress: Address;
  readonly agentAddress: Address;
  readonly relayerAddress: Address;
}

export type ChainEscrowConfig = ChainConfig & {
  relayerKey: Hex;
  agentKey: Hex;
  /** AGENT_ADDRESS as the Gate sees it; must equal the agent key's address. */
  expectedAgentAddress?: string | null;
  receiptTimeoutMs?: number;
  /** Tests: inject a client (e.g. anvil). */
  publicClient?: PublicClient;
};

const KEY = /^0x[0-9a-fA-F]{64}$/;

/** The attestation the Gate decided on (the registry's wire object); re-checked before sending. */
const StoredAttestation = z.object({
  merchant: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  kind: z.number().int().min(0).max(255),
  caseRef: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  issuedAt: z.number().int().min(0),
  expiresAt: z.number().int().min(0),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

/** Integer as bigint (scripts), number or decimal string (JSON from the routes). */
const Uint = z.union([z.bigint().nonnegative(), z.number().int().nonnegative(), z.string().regex(/^\d+$/)]).transform((v) => BigInt(v));

/** ERC-2612 permit; value and deadline as bigint, number or decimal string. */
const PermitJson = z.object({
  value: Uint,
  deadline: Uint,
  v: z.number().int().min(0).max(255),
  r: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  s: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});
const HEX_SIG = /^0x[0-9a-fA-F]{130}$/;

/** JSON-safe copy of decoded logs (bigints become decimal strings) for result_json. */
function jsonSafe(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonSafe(x)]));
  return v;
}

function revertReason(e: unknown): string | null {
  if (!(e instanceof BaseError)) return null;
  const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
  if (r instanceof ContractFunctionRevertedError) return r.data?.errorName ?? r.reason ?? "execution_reverted";
  return null;
}

export function createChainEscrow(cfg: ChainEscrowConfig): ChainEscrowAdapter {
  if (!KEY.test(cfg.relayerKey) || !KEY.test(cfg.agentKey)) throw new Error("chain escrow: relayer or agent key is malformed");
  const accounts: Record<Sender, PrivateKeyAccount> = {
    relayer: privateKeyToAccount(cfg.relayerKey),
    agent: privateKeyToAccount(cfg.agentKey),
  };
  if (cfg.expectedAgentAddress && cfg.expectedAgentAddress.toLowerCase() !== accounts.agent.address.toLowerCase()) {
    // The Gate checks plan.agent against AGENT_ADDRESS; a different key would only produce BadCaller reverts.
    throw new Error("chain escrow: AGENT_ADDRESS does not match AGENT_PRIVATE_KEY");
  }
  const client = cfg.publicClient ?? publicClientFor(cfg);
  const escrow = cfg.escrowAddress;
  const timeout = cfg.receiptTimeoutMs ?? 30_000;

  async function result(hash: Hex): Promise<ChainResult | null> {
    const receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
    if (!receipt) return null;
    if (receipt.status === "success") {
      const events = parseEventLogs({ abi: PREPAID_ESCROW_ABI, logs: receipt.logs }).map((l) => ({ event: l.eventName, args: jsonSafe(l.args) }));
      return { status: "confirmed", txHash: hash, blockNumber: receipt.blockNumber, events };
    }
    return { status: "reverted", txHash: hash, reason: "execution_reverted" };
  }

  async function settleRow(userId: string, actionId: string, hash: Hex): Promise<ChainResult> {
    let res: ChainResult | null;
    try {
      const receipt = await client.waitForTransactionReceipt({ hash, timeout });
      res = await result(receipt.transactionHash);
    } catch {
      res = null; // timeout or RPC failure: outcome unknown, reconcile re-broadcasts the same hash
    }
    if (!res) return { status: "pending", txHash: hash };
    await withUserTx(userId, (tx) =>
      tx.query(
        `update public.chain_txs set status = $2, block_number = $3, revert_reason = $4, confirmed_at = now()
          where action_id = $1`,
        [actionId, res.status, res.status === "confirmed" ? res.blockNumber?.toString() : null, res.status === "reverted" ? res.reason : null],
      ),
    );
    return res;
  }

  async function broadcast(raw: Hex, hash: Hex): Promise<void> {
    try {
      await client.sendRawTransaction({ serializedTransaction: raw });
    } catch (e) {
      // Re-broadcast of a transaction the node already has (or already mined) is not an error.
      const msg = e instanceof Error ? e.message.toLowerCase() : "";
      if (msg.includes("already known") || msg.includes("nonce too low") || msg.includes("already imported")) return;
      if (await client.getTransactionReceipt({ hash }).catch(() => null)) return;
      throw e;
    }
  }

  async function send(fn: EscrowFunction, args: readonly unknown[], o: EscrowSendOpts): Promise<ChainResult> {
    if (!o.userId) throw new SettlementError("escrow_user_missing", true);
    const sender = SENDER_OF[fn];
    const account = accounts[sender];

    // 1. Already signed for this action: same transaction, same hash.
    const existing = await withUserTx(o.userId, async (tx) => {
      const r = await tx.query("select raw_tx, tx_hash, status from public.chain_txs where action_id = $1", [o.actionId]);
      return r.rows[0] as { raw_tx: Hex; tx_hash: Hex; status: string } | undefined;
    });
    if (existing) {
      if (existing.status === "confirmed" || existing.status === "reverted") {
        const done = await result(existing.tx_hash);
        if (done) return done;
      }
      try {
        await broadcast(existing.raw_tx, existing.tx_hash);
      } catch {
        return { status: "pending", txHash: existing.tx_hash };
      }
      return settleRow(o.userId, o.actionId, existing.tx_hash);
    }

    // 2. Simulate: a revert here sends nothing (and spends no gas).
    const call = { address: escrow, abi: PREPAID_ESCROW_ABI, functionName: fn, args, account } as const;
    let gas: bigint;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- args are built per function below
      gas = await client.estimateContractGas(call as any);
    } catch (e) {
      const reason = revertReason(e);
      if (reason) return { status: "reverted", txHash: null, reason };
      throw new SettlementError("chain_rpc_unavailable", true, String(e)); // nothing was signed or sent
    }
    const fees = await client.estimateFeesPerGas().catch((e) => {
      throw new SettlementError("chain_rpc_unavailable", true, String(e));
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same call as above
    const data = encodeFunctionData({ abi: PREPAID_ESCROW_ABI, functionName: fn, args } as any);

    // 3. Allocate the nonce, sign and record in one transaction.
    const signed = await withUserTx(o.userId, async (tx) => {
      const addr = account.address.toLowerCase();
      await tx.query("insert into public.chain_nonces (sender, next_nonce) values ($1, 0) on conflict (sender) do nothing", [addr]);
      const row = await tx.query("select next_nonce from public.chain_nonces where sender = $1 for update", [addr]);
      const pending = await client.getTransactionCount({ address: account.address, blockTag: "pending" });
      const nonce = Math.max(Number(row.rows[0].next_nonce), pending);
      const raw = await account.signTransaction({
        chainId: cfg.chainId,
        type: "eip1559",
        to: escrow,
        data,
        nonce,
        gas: (gas * BigInt(12)) / BigInt(10), // 20% headroom over the estimate
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });
      const hash = keccak256(raw);
      await tx.query(
        `insert into public.chain_txs (user_id, action_id, sender, method, raw_tx, tx_hash, nonce, status)
         values ($1, $2, $3, $4, $5, $6, $7, 'signed')`,
        [o.userId, o.actionId, sender, fn, raw, hash, nonce],
      );
      await tx.query("update public.chain_nonces set next_nonce = $2, updated_at = now() where sender = $1", [addr, nonce + 1]);
      return { raw, hash };
    });

    // 4. Broadcast. A failure here leaves the signed row; the outcome is unknown, not failed.
    try {
      await broadcast(signed.raw, signed.hash);
    } catch {
      return { status: "pending", txHash: signed.hash };
    }
    await withUserTx(o.userId, (tx) =>
      tx.query("update public.chain_txs set status = 'broadcast', submitted_at = now() where action_id = $1 and status = 'signed'", [o.actionId]),
    );

    // 5. Receipt.
    return settleRow(o.userId, o.actionId, signed.hash);
  }

  return {
    escrowAddress: escrow,
    agentAddress: accounts.agent.address,
    relayerAddress: accounts.relayer.address,

    async readPlan(chainPlanId): Promise<EscrowPlanState | null> {
      let plan;
      try {
        plan = await readChainPlan(client, escrow, BigInt(chainPlanId));
      } catch (e) {
        throw new SettlementError("escrow_read_failed", false, String(e));
      }
      if (!plan) return null;
      return {
        chainPlanId: plan.planId.toString(),
        owner: plan.consumer,
        merchant: plan.merchant,
        agent: plan.agent,
        status: plan.status,
        unitPrice: Number(plan.unitPrice),
        unitsTotal: plan.units,
        unitsRedeemed: plan.redeemed,
      };
    },

    async exitWithAttestation(a, o) {
      // Exactly the attestation the Gate decided on; the contract re-verifies the oracle signature.
      const att = StoredAttestation.safeParse(a.attestation);
      if (!att.success) throw new SettlementError("attestation_malformed", true);
      const t = att.data;
      return send(
        "exitWithAttestation",
        [
          BigInt(a.chainPlanId),
          { merchant: t.merchant as Address, kind: t.kind, caseRef: t.caseRef as Hex, issuedAt: BigInt(t.issuedAt), expiresAt: BigInt(t.expiresAt) },
          t.signature as Hex,
        ],
        o,
      );
    },

    async exitVoluntary(a, o) {
      // The owner's VoluntaryExit signature, re-verified by the executor in phase B. Relayed.
      // Never send without it: nothing is signed or broadcast.
      if (typeof a.consumerSig !== "string" || !HEX_SIG.test(a.consumerSig)) {
        return { status: "reverted", txHash: null, reason: "consumer_signature_required" };
      }
      return send("exitVoluntaryBySig", [BigInt(a.chainPlanId), BigInt(a.deadline), a.consumerSig as Hex], o);
    },

    async purchase(a, o) {
      const permit = PermitJson.safeParse(a.permit);
      if (!permit.success) throw new SettlementError("permit_required", true);
      if (!HEX_SIG.test(a.merchantSig) || !HEX_SIG.test(a.consumerSig)) throw new SettlementError("signature_malformed", true);
      const p: PermitSig = { value: permit.data.value, deadline: permit.data.deadline, v: permit.data.v, r: permit.data.r as Hex, s: permit.data.s as Hex };
      // toOfferMessage / toPurchaseAuthMessage accept the JSON wire form; BigInt() is a no-op on bigints.
      return send("purchaseWithPermit", [toOfferMessage(a.offer), a.merchantSig as Hex, toPurchaseAuthMessage(a.auth), a.consumerSig as Hex, p], o);
    },

    async redeem(a, o) {
      if (!HEX_SIG.test(a.merchantSig) || !HEX_SIG.test(a.consumerSig)) throw new SettlementError("signature_malformed", true);
      return send("redeem", [BigInt(a.chainPlanId), a.sessionNo, BigInt(a.deadline), a.consumerSig as Hex, a.merchantSig as Hex], o);
    },

    async lookup(idempotencyKey, userId?: string) {
      if (!userId) return null; // chain_txs is user-scoped; no cross-user reads
      const hash = await withUserTx(userId, async (tx) => {
        const r = await tx.query(
          `select c.tx_hash from public.chain_txs c join public.actions a on a.id = c.action_id where a.idempotency_key = $1`,
          [idempotencyKey],
        );
        return r.rows[0]?.tx_hash as Hex | undefined;
      });
      if (!hash) return null;
      return (await result(hash)) ?? { status: "pending", txHash: hash };
    },
  };
}

/**
 * The adapter from the environment (REINS_ESCROW=chain). Throws when the chain or keys are not
 * configured, so a misconfigured deployment fails on the first prepaid action instead of
 * silently falling back to the mock.
 */
export function chainEscrowFromEnv(env: Record<string, string | undefined> = process.env): ChainEscrowAdapter {
  const chain = chainConfigFromEnv(env);
  if (!chain) throw new SettlementError("escrow_not_configured", true);
  return createChainEscrow({
    ...chain,
    relayerKey: (process.env.RELAYER_PRIVATE_KEY ?? "").trim() as Hex,
    agentKey: (process.env.AGENT_PRIVATE_KEY ?? "").trim() as Hex,
    expectedAgentAddress: env.AGENT_ADDRESS,
    receiptTimeoutMs: env.CHAIN_RECEIPT_TIMEOUT_MS ? Number(env.CHAIN_RECEIPT_TIMEOUT_MS) : undefined,
  });
}
