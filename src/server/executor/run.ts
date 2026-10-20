// Owner: R2 (roles.md). Minimal version by R1; extend, don't duplicate.
// ActionExecutor (architecture §8.2): the ONLY caller of settlement adapters (G1).
//   Phase A  load + integrity (args hash), idempotent re-entry, chain/escrow reads. No locks.
//   Phase B  one transaction: app.user_id, lock daily_limits row, snapshot from DB rows, decide,
//            audit, replan check, reserve cap, consume approval (exactly one row), -> executing.
//   Phase C  settle outside any transaction with the action's idempotency key, then finalize
//            succeeded / failed (definitive) / unknown (reconcile decides later).

import type { ActionExecutorPort, ExecResult, GateResult } from "@/src/core/types";
import { decide } from "@/src/core/gate/decide";
import { withUserTx } from "@/src/server/db/pool";
import { appendAudit } from "@/src/server/audit";
import { assertGateNotDisabled } from "@/src/server/platform/eval-guard";
import { consumeApproval, createApprovalTx, expireOpenApprovalsFor } from "@/src/server/approvals";
import { createMockbankSettlement, createMockEscrow, type MockbankTransport } from "@/src/server/adapters/settlement/mockbank";
import { chainEscrowFromEnv } from "@/src/server/adapters/settlement/chain/escrow";
import { SettlementError, type EscrowAdapter, type EscrowPurchaseArgs, type SettlementAdapter } from "@/src/server/adapters/settlement/types";
import { verifiedVoluntaryExitSignature, type VoluntaryExitSignature } from "@/src/server/prepaid/exit-signature";
import type { AttestationJson } from "@/src/sim/registry/eip712";
import {
  ACTION_COLUMNS,
  buildSnapshot,
  prepaidChainPlanId,
  typedAction,
  userCtx,
  verifyActionHash,
  type ActionRow,
  type PhaseAFacts,
} from "./snapshot";

/** Statuses from which execution may start. Anything else is returned as is (idempotent). */
const ENTRY_STATUSES = ["planned", "ready", "awaiting_approval"];
/** Reservations not finalized within this window are released by `reconcile` (PRD §10.4). */
const RESERVATION_TTL_SECONDS = 60;
/** Executor fail-closed rule (not a Gate rule): an approved prepaid_exit whose stored owner
 *  signature no longer verifies in phase B. Same name as its audit event. */
const CONSUMER_SIG_INVALID = "executor.consumer_signature_invalid";

/** The Gate's result as the deny the executor enforces, so the action row and the audit log
 *  explain it (G7). The Gate's own trace is kept; decide() is not involved. */
function executorDeny(gate: GateResult, ruleId: string): GateResult {
  return {
    ...gate,
    decision: "deny",
    ruleIds: [ruleId],
    reasons: [ruleId],
    trace: [...gate.trace, { ruleId, result: "deny", reason: ruleId }],
  };
}

export type ExecutorDeps = {
  settlement?: SettlementAdapter;
  escrow?: EscrowAdapter;
  /** In-process transport for the default mock bank adapters (tests). */
  transport?: MockbankTransport;
};

export type ActionExecutor = ActionExecutorPort & {
  /** Dry-run decision for routing (architecture §6.3). Not a security boundary; no reservation. */
  preview(actionId: string, userId: string): Promise<GateResult>;
};

async function loadAction(userId: string, actionId: string): Promise<ActionRow | null> {
  return withUserTx(userId, async (tx) => {
    const r = await tx.query(`select ${ACTION_COLUMNS} from public.actions where id = $1 and user_id = $2`, [actionId, userId]);
    return (r.rows[0] as ActionRow | undefined) ?? null;
  });
}

async function phaseA(userId: string, action: ActionRow, escrow: EscrowAdapter): Promise<PhaseAFacts> {
  if (!action.tool.startsWith("prepaid_")) return {};
  const chainPlanId = await withUserTx(userId, (tx) => prepaidChainPlanId(tx, action));
  if (!chainPlanId) return { escrowPlan: null };
  return { escrowPlan: await escrow.readPlan(chainPlanId) };
}

/**
 * REINS_ESCROW=chain uses PrepaidEscrow on chain; anything else the mock escrow (§24.13). The
 * chain adapter is built on first use, so a misconfigured chain fails the prepaid action
 * (escrow_not_configured, definitive) instead of silently using the mock.
 */
function defaultEscrow(transport: MockbankTransport | undefined): EscrowAdapter {
  if (process.env.REINS_ESCROW !== "chain") return createMockEscrow({ transport });
  let chain: EscrowAdapter | null = null;
  const get = () => (chain ??= chainEscrowFromEnv());
  return {
    readPlan: (id) => get().readPlan(id),
    purchase: (a, o) => get().purchase(a, o),
    redeem: (a, o) => get().redeem(a, o),
    exitWithAttestation: (a, o) => get().exitWithAttestation(a, o),
    exitVoluntary: (a, o) => get().exitVoluntary(a, o),
    lookup: (k, u) => get().lookup(k, u),
  };
}

export function createExecutor(deps: ExecutorDeps = {}): ActionExecutor {
  assertGateNotDisabled(process.env); // I-04: a production process must not run with the Gate off
  const settlement = deps.settlement ?? createMockbankSettlement({ transport: deps.transport });
  const escrow = deps.escrow ?? defaultEscrow(deps.transport);

  async function run(actionId: string, userId: string): Promise<ExecResult> {
    // ---- Phase A ------------------------------------------------------------------------
    const action = await loadAction(userId, actionId);
    if (!action) return { actionId, status: "failed", error: "action_not_found" };
    if (!verifyActionHash(action)) {
      await withUserTx(userId, (tx) =>
        appendAudit(tx, userId, { actor: "system", eventType: "executor.hash_mismatch", data: { actionId } }),
      );
      return { actionId, status: action.status as ExecResult["status"], error: "hash_mismatch" };
    }
    if (!ENTRY_STATUSES.includes(action.status)) {
      return { actionId, status: action.status as ExecResult["status"], result: action.result_json ?? undefined };
    }
    const facts = await phaseA(userId, action, escrow);

    // ---- Phase B ------------------------------------------------------------------------
    type B =
      | { kind: "stop"; res: ExecResult }
      | {
          kind: "go";
          gate: GateResult;
          row: ActionRow;
          approved: boolean;
          attestationId: string | null;
          exitSig: VoluntaryExitSignature | null;
        };
    const b = await withUserTx<B>(userId, async (tx) => {
      const ctx = await userCtx(tx, userId);
      await tx.query("insert into public.daily_limits (user_id, day) values ($1, $2) on conflict do nothing", [userId, ctx.day]);
      await tx.query("select used from public.daily_limits where user_id = $1 and day = $2 for update", [userId, ctx.day]);

      // Re-read under the lock: a concurrent run may have moved this action already.
      const cur = (await tx.query(`select ${ACTION_COLUMNS} from public.actions where id = $1 for update`, [actionId])).rows[0] as ActionRow;
      if (!ENTRY_STATUSES.includes(cur.status)) {
        return { kind: "stop", res: { actionId, status: cur.status as ExecResult["status"], result: cur.result_json ?? undefined } };
      }

      // The row may have changed since phase A: the hash must hold for what we are about to decide on.
      if (!verifyActionHash(cur)) {
        await appendAudit(tx, userId, { actor: "system", eventType: "executor.hash_mismatch", data: { actionId, phase: "execute" } });
        return { kind: "stop", res: { actionId, status: cur.status as ExecResult["status"], error: "hash_mismatch" } };
      }

      const snap = await buildSnapshot(tx, cur, ctx, facts);
      const gate = decide(typedAction(cur), snap);
      // The attestation the decision used; settlement passes exactly this one (never re-selects).
      const attestationId = snap.prepaid?.attestation?.id ?? null;
      await appendAudit(tx, userId, {
        actor: "gate",
        eventType: "decision",
        data: { actionId, tool: cur.tool, phase: "execute", argsHash: cur.args_hash, result: gate, ...(attestationId ? { attestationId } : {}) },
      });

      // PRD §10.6: mandate changed since planning and the decision changed -> cancel, re-plan.
      if (snap.mandate && cur.mandate_version !== snap.mandate.version && cur.preview_decision && gate.decision !== cur.preview_decision) {
        await tx.query(
          "update public.actions set status = 'cancelled_replan', decision = $2, rule_ids = $3, gate_json = $4 where id = $1",
          [actionId, gate.decision, gate.ruleIds, JSON.stringify(gate)],
        );
        await expireOpenApprovalsFor(tx, userId, [actionId], "cancelled_replan");
        return { kind: "stop", res: { actionId, status: "cancelled_replan", gate, replan: true } };
      }

      if (gate.decision !== "allow") {
        const status = gate.decision === "deny" ? "denied" : "awaiting_approval";
        await tx.query("update public.actions set status = $2, decision = $3, rule_ids = $4, gate_json = $5 where id = $1", [
          actionId,
          status,
          gate.decision,
          gate.ruleIds,
          JSON.stringify(gate),
        ]);
        if (status === "denied") await expireOpenApprovalsFor(tx, userId, [actionId], "denied");
        // The user needs a card to act on, whether or not preview routed here first. Re-uses
        // the action's open approval if one exists.
        else await createApprovalTx(tx, userId, actionId);
        return { kind: "stop", res: { actionId, status, gate } };
      }

      const approved = gate.ruleIds.includes("approval.valid");
      // An approved prepaid_exit settles with the owner's VoluntaryExit signature. Re-verify it in
      // this transaction and fail closed before any cap is reserved or the approval consumed.
      let exitSig: VoluntaryExitSignature | null = null;
      if (cur.tool === "prepaid_exit" && approved) {
        exitSig = facts.escrowPlan
          ? await verifiedVoluntaryExitSignature(tx, actionId, {
              chainPlanId: facts.escrowPlan.chainPlanId,
              owner: facts.escrowPlan.owner,
              nowSeconds: Math.floor(Date.parse(ctx.now) / 1000),
            })
          : null;
        if (!exitSig) {
          const denied = executorDeny(gate, CONSUMER_SIG_INVALID);
          await tx.query("update public.actions set status = 'denied', decision = 'deny', rule_ids = $2, gate_json = $3 where id = $1", [
            actionId,
            denied.ruleIds,
            JSON.stringify(denied),
          ]);
          await expireOpenApprovalsFor(tx, userId, [actionId], "consumer_signature_invalid");
          // The Gate's `decision` event above stays the record of decide()'s output; this event
          // records the executor's deny. Never includes the signature itself.
          await appendAudit(tx, userId, {
            actor: "system",
            eventType: CONSUMER_SIG_INVALID,
            data: { actionId, tool: cur.tool, phase: "execute", argsHash: cur.args_hash, gateDecision: gate.decision, result: denied },
          });
          return { kind: "stop", res: { actionId, status: "denied", gate: denied, error: "consumer_signature_invalid" } };
        }
      }

      if (gate.amountBase > 0) {
        const payee = cur.tool === "pay_bill" ? String(cur.args_json.biller_id) : null;
        await tx.query(
          `insert into public.cap_reservations (user_id, day, action_id, payee_id, amount, status, expires_at)
           values ($1, $2, $3, $4, $5, 'reserved', now() + make_interval(secs => $6))`,
          [userId, ctx.day, actionId, payee, gate.amountBase, RESERVATION_TTL_SECONDS],
        );
        await tx.query("update public.daily_limits set used = used + $3 where user_id = $1 and day = $2", [userId, ctx.day, gate.amountBase]);
      }

      if (approved && !(await consumeApproval(tx, actionId, cur.args_hash))) {
        throw new Error("approval_consume_failed"); // rolls back the reservation too
      }

      const u = await tx.query(
        `update public.actions set status = 'executing', decision = 'allow', rule_ids = $2, gate_json = $3
          where id = $1 and status = any($4)`,
        [actionId, gate.ruleIds, JSON.stringify(gate), ENTRY_STATUSES],
      );
      if (u.rowCount !== 1) throw new Error("action_state_changed");
      return { kind: "go", gate, row: cur, approved, attestationId, exitSig };
    });
    if (b.kind === "stop") return b.res;

    // ---- Phase C ------------------------------------------------------------------------
    const { gate, row, approved, attestationId, exitSig } = b;
    let outcome: { status: "succeeded" | "failed" | "unknown"; result: unknown; error?: string };
    try {
      outcome = { status: "succeeded", result: await settle(row, approved, attestationId, exitSig) };
    } catch (e) {
      const definitive = e instanceof SettlementError && e.definitive;
      const code = e instanceof Error ? e.message : String(e);
      outcome = { status: definitive ? "failed" : "unknown", result: e instanceof SettlementError ? { error: code, raw: e.raw } : { error: code }, error: code };
    }
    await finalize(row, outcome);
    return { actionId, status: outcome.status, gate, result: outcome.result, error: outcome.error };
  }

  async function settle(
    row: ActionRow,
    approved: boolean,
    attestationId: string | null,
    exitSig: VoluntaryExitSignature | null,
  ): Promise<unknown> {
    const opts = { idempotencyKey: row.idempotency_key, customerId: row.user_id };
    const a = row.args_json;
    switch (row.tool) {
      case "pay_bill": {
        const currency = await withUserTx(row.user_id, async (tx) => {
          const r = await tx.query("select currency from public.bills where id = $1", [a.bill_id]);
          return String(r.rows[0]?.currency ?? "");
        });
        const r = await settlement.payBill(
          { billId: String(a.bill_id), billerId: String(a.biller_id), amount: Number(a.amount), currency },
          opts,
        );
        return { reference: r.reference, ...(r.raw as object) };
      }
      case "cancel_subscription": {
        const r = await settlement.cancelSubscription({ subscriptionId: String(a.subscription_id) }, opts);
        return { reference: r.reference, ...(r.raw as object) };
      }
      case "prepaid_exit": {
        const ids = await withUserTx(row.user_id, async (tx) => {
          const r = await tx.query("select chain_plan_id::text as chain_plan_id from public.prepaid_plans where id = $1", [a.plan_id]);
          return r.rows[0] as { chain_plan_id: string } | undefined;
        });
        if (!ids) throw new SettlementError("plan_not_found", true);
        if (!approved && !attestationId) throw new SettlementError("attestation_missing", true);
        const sendOpts = { actionId: row.id, idempotencyKey: row.idempotency_key, userId: row.user_id };
        // The escrow re-verifies the oracle signature, so it gets the signed record the Gate used.
        const attestation = approved
          ? null
          : await withUserTx(row.user_id, async (tx) => {
              const r = await tx.query("select raw_json from public.attestations where id = $1", [attestationId]);
              return (r.rows[0]?.raw_json as AttestationJson | undefined) ?? null;
            });
        if (!approved && !attestation) throw new SettlementError("attestation_missing", true);
        // Approved path: the Gate only upgrades an unattested exit to allow when the consumer's
        // voluntary-exit signature verified (consumerSigValid) and an approval is valid. The
        // escrow gets exactly the signature phase B re-verified (exitVoluntaryBySig on chain).
        if (approved && !exitSig) throw new SettlementError("consumer_signature_required", true);
        const res = approved
          ? await escrow.exitVoluntary({ chainPlanId: ids.chain_plan_id, deadline: exitSig!.deadline, consumerSig: exitSig!.consumerSig }, sendOpts)
          : await escrow.exitWithAttestation({ chainPlanId: ids.chain_plan_id, attestationId: attestationId!, attestation: attestation! }, sendOpts);
        if (res.status === "reverted") throw new SettlementError(res.reason, true, res);
        if (res.status === "pending") throw new SettlementError("pending", false, res);
        return { txHash: res.txHash, simulated: res.txHash.startsWith("mock:"), mode: approved ? "voluntary" : "attested", events: res.events };
      }
      case "prepaid_purchase":
      case "prepaid_redeem":
      case "prepaid_exit_voluntary": {
        // User-signed actions (R2-06): the escrow gets exactly the payload phase B re-verified,
        // and re-verifies it itself. Relayed: the relayer pays gas, never chooses a recipient.
        const sendOpts = { actionId: row.id, idempotencyKey: row.idempotency_key, userId: row.user_id };
        const payload = await withUserTx(row.user_id, async (tx) => {
          const r = await tx.query("select payload from public.prepaid_action_signatures where action_id = $1 and tool = $2", [row.id, row.tool]);
          return r.rows[0]?.payload as Record<string, unknown> | undefined;
        });
        if (!payload) throw new SettlementError("consumer_signature_required", true);
        let chainPlanId: string | null = null;
        if (row.tool !== "prepaid_purchase") {
          chainPlanId = await withUserTx(row.user_id, async (tx) => {
            const r = await tx.query("select chain_plan_id::text as id from public.prepaid_plans where id = $1", [a.plan_id]);
            return (r.rows[0]?.id as string | undefined) ?? null;
          });
          if (!chainPlanId) throw new SettlementError("plan_not_found", true);
        }
        const res =
          row.tool === "prepaid_purchase"
            ? await escrow.purchase(
                {
                  offer: payload.offer as EscrowPurchaseArgs["offer"],
                  merchantSig: String(payload.merchantSig),
                  auth: payload.auth as EscrowPurchaseArgs["auth"],
                  consumerSig: String(payload.consumerSig),
                  permit: payload.permit,
                },
                sendOpts,
              )
            : row.tool === "prepaid_redeem"
              ? await escrow.redeem(
                  {
                    chainPlanId: chainPlanId!,
                    sessionNo: Number(payload.sessionNo),
                    deadline: Number(payload.deadline),
                    consumerSig: String(payload.consumerSig),
                    merchantSig: String(payload.merchantSig),
                  },
                  sendOpts,
                )
              : await escrow.exitVoluntary({ chainPlanId: chainPlanId!, deadline: Number(payload.deadline), consumerSig: String(payload.consumerSig) }, sendOpts);
        if (res.status === "reverted") throw new SettlementError(res.reason, true, res);
        if (res.status === "pending") throw new SettlementError("pending", false, res);
        return { txHash: res.txHash, simulated: res.txHash.startsWith("mock:"), events: res.events };
      }
      default:
        throw new SettlementError(`${row.tool}_not_supported`, true);
    }
  }

  /**
   * Mock escrow only: there is no chain to index, so the confirmed purchase (the escrow's own event:
   * plan id, consumer, merchant) becomes the user's prepaid_plans row here. On chain, chain-sync
   * indexes it from the Purchased log instead and this is a no-op.
   */
  async function mirrorMockPurchase(tx: import("pg").PoolClient, row: ActionRow, result: unknown) {
    const r = result as { txHash?: string; simulated?: boolean; events?: { chainPlanId?: string; merchant?: string }[] };
    const ev = r.events?.[0];
    if (!r.simulated || !ev?.chainPlanId || !ev.merchant || !r.txHash) return;
    await tx.query(
      `insert into public.prepaid_plans (user_id, chain_plan_id, merchant_id, unit_price, units_total, units_redeemed, cancel_fee_bps,
         agent_address, status, purchase_tx, origin, last_synced_block)
       select $1, $2, m.id, o.unit_price, o.units, 0, o.cancel_fee_bps, $5, 'active', $3, 'chain', 0
         from public.prepaid_offers o join public.prepaid_merchants m on m.id = o.merchant_id
        where o.id = $4 and lower(m.chain_address) = lower($6)
       on conflict (chain_plan_id) do nothing`,
      [row.user_id, ev.chainPlanId, r.txHash, row.args_json.offer_id, process.env.AGENT_ADDRESS ?? null, ev.merchant],
    );
  }

  async function finalize(row: ActionRow, o: { status: "succeeded" | "failed" | "unknown"; result: unknown; error?: string }) {
    await withUserTx(row.user_id, async (tx) => {
      const res = await tx.query(
        "select day, amount from public.cap_reservations where action_id = $1 and status = 'reserved' for update",
        [row.id],
      );
      const r = res.rows[0];
      if (r && o.status === "failed") {
        // Same lock order as phase B: daily_limits first.
        await tx.query("update public.daily_limits set used = used - $3 where user_id = $1 and day = $2", [row.user_id, r.day, r.amount]);
        await tx.query("update public.cap_reservations set status = 'released' where action_id = $1", [row.id]);
      } else if (r && o.status === "succeeded") {
        await tx.query("update public.cap_reservations set status = 'committed' where action_id = $1", [row.id]);
      } // unknown: keep reserved; reconcile settles it.

      await tx.query("update public.actions set status = $2, result_json = $3, executed_at = now() where id = $1 and status = 'executing'", [
        row.id,
        o.status,
        JSON.stringify(o.result ?? null),
      ]);

      if (o.status === "succeeded") {
        // Mirror the settled effect in the app's view (sync would also catch up).
        if (row.tool === "pay_bill") await tx.query("update public.bills set status = 'paid' where id = $1", [row.args_json.bill_id]);
        if (row.tool === "cancel_subscription") {
          await tx.query("update public.subscriptions set status = 'cancelled' where id = $1", [row.args_json.subscription_id]);
        }
        if (row.tool === "prepaid_purchase") await mirrorMockPurchase(tx, row, o.result);
        if (row.tool === "prepaid_exit_voluntary") {
          await tx.query("update public.prepaid_plans set status = 'exited_voluntary' where id = $1", [row.args_json.plan_id]);
        }
        if (row.tool === "prepaid_redeem") {
          // The indexer (chain) or mock sync records the session with its tx; mirror the counter now.
          await tx.query("update public.prepaid_plans set units_redeemed = greatest(units_redeemed, $2) where id = $1", [
            row.args_json.plan_id,
            row.args_json.session_no,
          ]);
        }
        if (row.tool === "prepaid_exit") {
          const mode = (o.result as { mode?: string }).mode;
          await tx.query("update public.prepaid_plans set status = $2 where id = $1", [
            row.args_json.plan_id,
            mode === "voluntary" ? "exited_voluntary" : "exited_attested",
          ]);
        }
      }
      await appendAudit(tx, row.user_id, {
        actor: "system",
        eventType: `execution.${o.status}`,
        data: { actionId: row.id, tool: row.tool, idempotencyKey: row.idempotency_key, result: o.result ?? null },
      });
    });
  }

  async function preview(actionId: string, userId: string): Promise<GateResult> {
    const action = await loadAction(userId, actionId);
    if (!action) throw new Error("action_not_found");
    if (!verifyActionHash(action)) throw new Error("hash_mismatch");
    const facts = await phaseA(userId, action, escrow);
    return withUserTx(userId, async (tx) => {
      const ctx = await userCtx(tx, userId);
      const gate = decide(typedAction(action), await buildSnapshot(tx, action, ctx, facts));
      const next = gate.decision === "allow" ? "ready" : gate.decision === "require_confirm" ? "awaiting_approval" : null;
      await tx.query(
        `update public.actions set preview_decision = $2, rule_ids = $3, gate_json = $4,
                status = case when status in ('planned','ready') and $5::text is not null then $5::text else status end
          where id = $1`,
        [actionId, gate.decision, gate.ruleIds, JSON.stringify(gate), next],
      );
      await appendAudit(tx, userId, {
        actor: "gate",
        eventType: "decision",
        data: { actionId, tool: action.tool, phase: "preview", argsHash: action.args_hash, result: gate },
      });
      return gate;
    });
  }

  return { run, preview };
}

let defaultExecutor: ActionExecutor | null = null;

/** The app's executor (mock bank over HTTP, mock escrow). */
export function getExecutor(): ActionExecutor {
  defaultExecutor ??= createExecutor();
  return defaultExecutor;
}
