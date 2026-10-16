// The `risk` cron job (architecture §11.1, §24.10 "Attested exit", PRD §12.9, FR19.4–FR19.5).
// For each merchant with active prepaid plans:
//   hard path  fetch attestations from the registry, recover the signer, store them; for a
//              signed, same-merchant, fresh attestation start ONE prepaid_risk plan per
//              (attestation, prepaid plan). The Planner proposes prepaid_exit(plan_id); the
//              executor and the Gate re-verify everything before any money moves.
//   soft path  run the quarantined Signal Reader; store a risk_signals row and a feed warning.
//              Soft signals never start a plan: there is no code path from here to an exit.

import type { TypedDataDomain } from "viem";
import type { SignalReaderPort } from "@/src/agent/deps";
import type { StartPlanInput } from "@/src/agent/run";
import type { ChatStreamEvent } from "@/src/server/api-types";
import { AttestationWire, freshness, verifyAttestation, type FreshnessReason } from "./attestation";

export type ActivePlan = { userId: string; planId: string; merchantId: string };
export type RiskMerchant = { id: string; chainAddress: string };
export type PrepaidPolicyFacts = { attestationMaxAgeDays: number; warnOnSoftSignals: boolean };
export type RiskLevel = "none" | "watch" | "elevated";

export type AttestationRow = {
  merchantId: string;
  kind: "court_enforcement" | "closure_notice";
  caseRefHash: string;
  issuedAt: Date;
  expiresAt: Date;
  signer: string;
  signature: string;
  sigValid: boolean;
  raw: AttestationWire;
};

export type RiskSignalRow = {
  merchantId: string;
  kind: "complaints" | "news";
  level: RiskLevel;
  summary: string;
  sourceIds: string[];
  simulated: boolean;
  observedAt: Date;
};

/** Storage for the job. The Postgres version is in ./repo.ts; tests use an in-memory fake. */
export interface RiskRepo {
  /** Active prepaid plans across users (system read). */
  listActivePlans(): Promise<ActivePlan[]>;
  getMerchants(ids: string[]): Promise<RiskMerchant[]>;
  /**
   * Upsert on (merchant_id, kind, case_ref_hash). An existing row is replaced only when it is
   * not signature-valid and the new one is, so a forged copy cannot shadow the real record.
   * Returns the stored row's id and validity.
   */
  saveAttestation(row: AttestationRow): Promise<{ id: string; sigValid: boolean }>;
  prepaidPolicy(userId: string): Promise<PrepaidPolicyFacts | null>;
  /**
   * Records (in the user's audit log) that this attestation triggered a plan for this prepaid
   * plan. False if it already did: one trigger per (attestation, prepaid plan), ever.
   */
  claimExitTrigger(input: {
    userId: string;
    prepaidPlanId: string;
    attestationId: string;
    merchantId: string;
    kind: string;
    simulated: boolean;
  }): Promise<boolean>;
  /**
   * Gives a claim back when no plan row could be created for it (e.g. another plan still holds
   * the key), so a later run can try again. Appends to the audit log; nothing is deleted.
   */
  releaseExitTrigger(input: { userId: string; prepaidPlanId: string; attestationId: string; reason: string }): Promise<void>;
  /** Inserts unless the same (merchant, kind, level, sources) was stored the same day. */
  saveSignal(row: RiskSignalRow): Promise<boolean>;
  setMerchantRiskLevel(merchantId: string, level: RiskLevel): Promise<void>;
  /** Feed warning for one user (audit event `risk.warning`). */
  recordWarning(userId: string, data: { merchantId: string; level: RiskLevel; summary: string; sourceIds: string[]; simulated: boolean }): Promise<void>;
}

export type RegistryClient = { fetchAttestations(merchantId: string): Promise<unknown[]> };

export type StartPlanFn = (input: StartPlanInput) => AsyncGenerator<ChatStreamEvent>;

export type RiskJobDeps = {
  repo: RiskRepo;
  registry: RegistryClient;
  signalReader: SignalReaderPort;
  startPlan: StartPlanFn;
  domain: TypedDataDomain;
  oracleAddress: string | null;
  /** v1 signals come from the registry simulator. */
  signalsSimulated: boolean;
  now?: () => Date;
};

type RejectReason = "malformed" | "unknown_kind" | "other_merchant" | "bad_signature" | FreshnessReason;

export type RiskJobStats = {
  merchants: number;
  activePlans: number;
  attestations: { seen: number; stored: number; valid: number; rejected: Partial<Record<RejectReason, number>> };
  plans: { started: { planId: string; prepaidPlanId: string; status: "done" | "paused" | "failed" | "unknown" }[]; alreadyTriggered: number };
  warnings: { merchantId: string; level: RiskLevel; stored: boolean }[];
  errors: { merchantId?: string; step: string; message: string }[];
};

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

/** v1 heuristic: a warning citing only news items is a `news` signal, otherwise `complaints`. */
function signalKind(sourceIds: string[]): "complaints" | "news" {
  return sourceIds.length > 0 && sourceIds.every((id) => /news/i.test(id)) ? "news" : "complaints";
}

/** Runs a plan to its end. `planId` stays null when the plan row was never created. */
async function drainPlan(start: StartPlanFn, input: StartPlanInput) {
  let planId: string | null = null;
  let status: "done" | "paused" | "failed" | "unknown" = "unknown";
  try {
    for await (const ev of start(input)) {
      if (ev.type === "plan") planId = ev.planId;
      if (ev.type === "approval_required") status = "paused";
      if (ev.type === "done" && status !== "paused") status = "done";
      if (ev.type === "error") status = "failed";
    }
  } catch (e) {
    return { planId, status: "failed" as const, error: e };
  }
  return { planId, status, error: null };
}

export async function runRiskJob(deps: RiskJobDeps): Promise<RiskJobStats> {
  const now = deps.now ?? (() => new Date());
  const stats: RiskJobStats = {
    merchants: 0,
    activePlans: 0,
    attestations: { seen: 0, stored: 0, valid: 0, rejected: {} },
    plans: { started: [], alreadyTriggered: 0 },
    warnings: [],
    errors: [],
  };
  const reject = (r: RejectReason) => (stats.attestations.rejected[r] = (stats.attestations.rejected[r] ?? 0) + 1);

  const plans = await deps.repo.listActivePlans();
  stats.activePlans = plans.length;
  const byMerchant = new Map<string, ActivePlan[]>();
  for (const p of plans) byMerchant.set(p.merchantId, [...(byMerchant.get(p.merchantId) ?? []), p]);
  const merchants = await deps.repo.getMerchants([...byMerchant.keys()]);
  stats.merchants = merchants.length;

  const policies = new Map<string, PrepaidPolicyFacts | null>();
  const policyFor = async (userId: string) => {
    if (!policies.has(userId)) policies.set(userId, await deps.repo.prepaidPolicy(userId));
    return policies.get(userId) ?? null;
  };

  for (const merchant of merchants) {
    const merchantPlans = byMerchant.get(merchant.id) ?? [];

    // ---- Hard signals: attestations --------------------------------------------------------
    let items: unknown[] = [];
    try {
      items = await deps.registry.fetchAttestations(merchant.id);
    } catch (e) {
      stats.errors.push({ merchantId: merchant.id, step: "fetch_attestations", message: errMsg(e) });
    }
    for (const raw of items) {
      stats.attestations.seen++;
      const parsed = AttestationWire.safeParse(raw);
      if (!parsed.success) {
        reject("malformed");
        continue;
      }
      // An attestation about another merchant is never stored under this one.
      if (parsed.data.merchant.toLowerCase() !== merchant.chainAddress.toLowerCase()) {
        reject("other_merchant");
        continue;
      }
      const v = await verifyAttestation(parsed.data, { domain: deps.domain, oracleAddress: deps.oracleAddress });
      if (!v) {
        reject("unknown_kind");
        continue;
      }
      let saved: { id: string; sigValid: boolean };
      try {
        saved = await deps.repo.saveAttestation({
          merchantId: merchant.id,
          kind: v.kind,
          caseRefHash: v.att.caseRef.toLowerCase(),
          issuedAt: new Date(v.att.issuedAt * 1000),
          expiresAt: new Date(v.att.expiresAt * 1000),
          signer: v.signer ?? "unrecoverable",
          signature: v.att.signature,
          sigValid: v.sigValid,
          raw: v.att,
        });
      } catch (e) {
        stats.errors.push({ merchantId: merchant.id, step: "save_attestation", message: errMsg(e) });
        continue;
      }
      stats.attestations.stored++;
      if (!v.sigValid || !saved.sigValid) {
        reject("bad_signature");
        continue;
      }
      stats.attestations.valid++;

      for (const plan of merchantPlans) {
        const policy = await policyFor(plan.userId);
        const fresh = freshness(v.att, now().getTime(), policy?.attestationMaxAgeDays ?? null);
        if (!fresh.ok) {
          reject(fresh.reason);
          continue;
        }
        try {
          const claimed = await deps.repo.claimExitTrigger({
            userId: plan.userId,
            prepaidPlanId: plan.planId,
            attestationId: saved.id,
            merchantId: merchant.id,
            kind: v.kind,
            simulated: v.att.simulated === true,
          });
          if (!claimed) {
            stats.plans.alreadyTriggered++;
            continue;
          }
          // userId comes from the plan row (scheduler), never from registry data (H8).
          const run = await drainPlan(deps.startPlan, { userId: plan.userId, trigger: "prepaid_risk", subjectId: plan.planId });
          if (!run.planId) {
            // No plan row: the trigger was not acted on, so give it back for the next run.
            await deps.repo.releaseExitTrigger({
              userId: plan.userId,
              prepaidPlanId: plan.planId,
              attestationId: saved.id,
              reason: "plan_not_created",
            });
            stats.errors.push({ merchantId: merchant.id, step: "start_plan", message: errMsg(run.error ?? "plan not created") });
            continue;
          }
          stats.plans.started.push({ planId: run.planId, prepaidPlanId: plan.planId, status: run.status });
        } catch (e) {
          stats.errors.push({ merchantId: merchant.id, step: "start_plan", message: errMsg(e) });
        }
      }
    }

    // ---- Soft signals: warning only ---------------------------------------------------------
    try {
      const warning = await deps.signalReader.read(merchant.id);
      if (!warning) continue;
      const { level, summary, sourceIds } = warning.value;
      await deps.repo.setMerchantRiskLevel(merchant.id, level);
      if (level === "none") {
        stats.warnings.push({ merchantId: merchant.id, level, stored: false });
        continue;
      }
      const stored = await deps.repo.saveSignal({
        merchantId: merchant.id,
        kind: signalKind(sourceIds),
        level,
        summary,
        sourceIds,
        simulated: deps.signalsSimulated,
        observedAt: now(),
      });
      stats.warnings.push({ merchantId: merchant.id, level, stored });
      if (!stored) continue;
      const users = [...new Set(merchantPlans.map((p) => p.userId))];
      for (const userId of users) {
        const policy = await policyFor(userId);
        if (policy && !policy.warnOnSoftSignals) continue;
        await deps.repo.recordWarning(userId, { merchantId: merchant.id, level, summary, sourceIds, simulated: deps.signalsSimulated });
      }
    } catch (e) {
      stats.errors.push({ merchantId: merchant.id, step: "signals", message: errMsg(e) });
    }
  }
  return stats;
}
