// Postgres RiskRepo (architecture §12, §24.8). Reference tables (prepaid_merchants,
// attestations, risk_signals) are written by reins_server; user-scoped reads and audit
// appends run in withUserTx so RLS applies.
//
// Listing active plans across users needs a system read that RLS does not grant reins_server.
// It calls public.risk_active_prepaid_plans() (security definer, requested from R3); until that
// function exists, it falls back to the users named in REINS_RISK_USER_IDS (demo config).

import { getPool, withUserTx } from "@/src/server/db/pool";
import { appendAudit } from "@/src/server/audit";
import { parsePolicy } from "@/src/core/mandate/schema";
import type { ActivePlan, AttestationRow, PrepaidPolicyFacts, RiskMerchant, RiskRepo, RiskSignalRow } from "./job";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNDEFINED_FUNCTION = "42883";

function fallbackUserIds(env = process.env): string[] {
  return (env.REINS_RISK_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => UUID_RE.test(s));
}

async function listActivePlans(): Promise<ActivePlan[]> {
  try {
    const r = await getPool().query<{ user_id: string; plan_id: string; merchant_id: string }>(
      "select user_id::text, plan_id::text, merchant_id from public.risk_active_prepaid_plans()",
    );
    return r.rows.map((x) => ({ userId: x.user_id, planId: x.plan_id, merchantId: x.merchant_id }));
  } catch (e) {
    if ((e as { code?: string }).code !== UNDEFINED_FUNCTION) throw e;
  }
  const out: ActivePlan[] = [];
  for (const userId of fallbackUserIds()) {
    const rows = await withUserTx(userId, async (tx) => {
      const r = await tx.query<{ id: string; merchant_id: string }>(
        "select id::text, merchant_id from public.prepaid_plans where user_id = $1 and status = 'active'",
        [userId],
      );
      return r.rows;
    });
    for (const x of rows) out.push({ userId, planId: x.id, merchantId: x.merchant_id });
  }
  return out;
}

export function createPgRiskRepo(): RiskRepo {
  return {
    listActivePlans,

    async getMerchants(ids: string[]): Promise<RiskMerchant[]> {
      if (ids.length === 0) return [];
      const r = await getPool().query<{ id: string; chain_address: string }>(
        "select id, chain_address from public.prepaid_merchants where id = any($1::text[]) order by id",
        [ids],
      );
      return r.rows.map((x) => ({ id: x.id, chainAddress: x.chain_address }));
    },

    async saveAttestation(a: AttestationRow) {
      const r = await getPool().query<{ id: string; sig_valid: boolean }>(
        `insert into public.attestations
           (merchant_id, kind, case_ref_hash, issued_at, expires_at, signer, signature, sig_valid, raw_json)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (merchant_id, kind, case_ref_hash) do update
           set issued_at = excluded.issued_at, expires_at = excluded.expires_at, signer = excluded.signer,
               signature = excluded.signature, sig_valid = excluded.sig_valid, raw_json = excluded.raw_json,
               received_at = now()
           where public.attestations.sig_valid = false and excluded.sig_valid = true
         returning id, sig_valid`,
        [a.merchantId, a.kind, a.caseRefHash, a.issuedAt, a.expiresAt, a.signer, a.signature, a.sigValid, JSON.stringify(a.raw)],
      );
      if (r.rowCount) return { id: r.rows[0].id, sigValid: r.rows[0].sig_valid };
      const existing = await getPool().query<{ id: string; sig_valid: boolean }>(
        "select id, sig_valid from public.attestations where merchant_id = $1 and kind = $2 and case_ref_hash = $3",
        [a.merchantId, a.kind, a.caseRefHash],
      );
      return { id: existing.rows[0].id, sigValid: existing.rows[0].sig_valid };
    },

    async prepaidPolicy(userId: string): Promise<PrepaidPolicyFacts | null> {
      return withUserTx(userId, async (tx) => {
        const r = await tx.query("select policy_json from public.mandates where user_id = $1 and status = 'active'", [userId]);
        if (!r.rowCount) return null;
        const parsed = parsePolicy(r.rows[0].policy_json);
        if (!parsed.ok) return null;
        const p = parsed.policy.prepaid;
        return { attestationMaxAgeDays: p.attestation_max_age_days, warnOnSoftSignals: p.warn_on_soft_signals };
      });
    },

    async claimExitTrigger({ userId, prepaidPlanId, attestationId, merchantId, kind, simulated }) {
      return withUserTx(userId, async (tx) => {
        await tx.query("select pg_advisory_xact_lock(hashtext('risk:' || $1 || ':' || $2))", [attestationId, prepaidPlanId]);
        // Claimed unless the latest event for this pair is a release.
        const last = await tx.query<{ event_type: string }>(
          `select event_type from public.audit_log
            where user_id = $1 and event_type in ('risk.exit_triggered', 'risk.exit_trigger_released')
              and event_json->>'attestationId' = $2 and event_json->>'prepaidPlanId' = $3
            order by seq desc limit 1`,
          [userId, attestationId, prepaidPlanId],
        );
        if (last.rows[0]?.event_type === "risk.exit_triggered") return false;
        await appendAudit(tx, userId, {
          actor: "system",
          eventType: "risk.exit_triggered",
          data: { prepaidPlanId, attestationId, merchantId, kind, source: "registry", simulated },
        });
        return true;
      });
    },

    async releaseExitTrigger({ userId, prepaidPlanId, attestationId, reason }) {
      await withUserTx(userId, async (tx) => {
        await tx.query("select pg_advisory_xact_lock(hashtext('risk:' || $1 || ':' || $2))", [attestationId, prepaidPlanId]);
        await appendAudit(tx, userId, {
          actor: "system",
          eventType: "risk.exit_trigger_released",
          data: { prepaidPlanId, attestationId, reason },
        });
      });
    },

    async saveSignal(s: RiskSignalRow) {
      const r = await getPool().query(
        `insert into public.risk_signals (merchant_id, kind, level, summary, source_ids, origin, simulated, observed_at)
         select $1, $2, $3, $4, $5::text[], $6, $7, $8
          where not exists (
            select 1 from public.risk_signals
             where merchant_id = $1 and kind = $2 and level = $3 and source_ids = $5::text[]
               and (observed_at at time zone 'UTC')::date = ($8::timestamptz at time zone 'UTC')::date)`,
        [s.merchantId, s.kind, s.level, s.summary, s.sourceIds, s.simulated ? "simulated" : "web", s.simulated, s.observedAt],
      );
      return (r.rowCount ?? 0) > 0;
    },

    async setMerchantRiskLevel(merchantId, level) {
      await getPool().query(
        "update public.prepaid_merchants set risk_level = $2, updated_at = now() where id = $1 and risk_level <> $2",
        [merchantId, level],
      );
    },

    async recordWarning(userId, data) {
      await withUserTx(userId, (tx) =>
        appendAudit(tx, userId, { actor: "agent", eventType: "risk.warning", data: { ...data, origin: "web" } }),
      );
    },
  };
}

/** job_runs bookkeeping (architecture §11.1). System table: no user scope. */
export async function startJobRun(job: string): Promise<string> {
  const r = await getPool().query<{ id: string }>("insert into public.job_runs (job) values ($1) returning id", [job]);
  return r.rows[0].id;
}

export async function finishJobRun(id: string, status: "succeeded" | "failed", stats: unknown, error?: string): Promise<void> {
  await getPool().query(
    "update public.job_runs set finished_at = now(), status = $2, stats_json = $3, error = $4 where id = $1",
    [id, status, JSON.stringify(stats ?? null), error ?? null],
  );
}
