// Seeded demo persona Lin (supabase/seed.sql) for the end-to-end tests and the demo recorder
// (scripts/record-demo.ts). Everything runs the real graph, the Postgres plan store, the
// executor, the Gate, approvals and the mock bank (in process). Only the models are replaced:
// RecordedModelClient in tests, RecordingModelClient when recording.
//
// The flows mutate Lin's seeded rows (bills get paid, the trial gets cancelled, the prepaid plan
// gets exited). Each `restore*` helper puts the touched rows back to their seeded state, so the
// demo seed stays usable without `supabase db reset`. Restores are split by area so test files
// that touch disjoint parts of Lin can run in parallel.

import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Pool } from "pg";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import type { AgentDeps, ModelClients } from "@/src/agent/deps";
import { compileGraph } from "@/src/agent/graph";
import { CHECKPOINT_SCHEMA, checkpointerConnString } from "@/src/agent/checkpointer";
import type { ModelClient } from "@/src/agent/models/types";
import { createDocumentReader } from "@/src/agent/nodes/reader";
import { createSignalReader, type SignalBundle } from "@/src/agent/nodes/signal_reader";
import { pgPlanRegistry, resumePlan, startPlan, type RunEnv } from "@/src/agent/run";
import type { ReadTool } from "@/src/agent/tools/types";
import type { ChatStreamEvent, ResumeResponse } from "@/src/server/api-types";
import { decideApproval } from "@/src/server/approvals";
import { withUserTx } from "@/src/server/db/pool";
import { createExecutor, type ActionExecutor } from "@/src/server/executor";
import { createPgDocumentRepo, type DocumentRepo } from "@/src/server/ingest/repo";
import { createLocalDocumentStorage } from "@/src/server/ingest/storage";
import { createDocumentLoader, ingestUpload, type IngestResult } from "@/src/server/ingest/upload";
import { PgPlanStore } from "@/src/server/plan-store";
import { inProcessTransport } from "../foundations/helpers";

// ---- Seeded ids ---------------------------------------------------------------------------

/** Same as pg_temp.sid() in supabase/seed.sql: an RFC 4122-shaped uuid from md5(label). */
export function seedId(label: string): string {
  const h = createHash("md5").update(label).digest("hex");
  const s = h.slice(0, 12) + "4" + h.slice(13, 16) + "8" + h.slice(17, 32);
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

export const LIN = "11111111-1111-4111-8111-111111111111";
export const LIN_CHECKING = "a0000000-0000-4000-8000-000000000001";
export const LIN_CHECKING_BALANCE = 12850.4;
/** Current unpaid bills from the seed: the anomalous ¥612 electricity bill and the ¥98 phone bill. */
export const BILLS = {
  power: { id: seedId("bill:SZ_POWER:0"), billerId: "SZ_POWER", amount: 612, payee: "State Grid Shenzhen" },
  mobile: { id: seedId("bill:CHINA_MOBILE:0"), billerId: "CHINA_MOBILE", amount: 98, payee: "China Mobile" },
} as const;
/** Keep Premium free trial (trial_status_origin = mock_bank). */
export const KEEP_TRIAL = "5b000000-0000-4000-8000-000000000004";
/** Lin's FitBox Futian escrow plan (chain plan 1, 48 sessions left at ¥100). */
export const FITBOX = "FITBOX_FUTIAN";
export const FITBOX_PLAN = "9a000000-0000-4000-8000-000000000001";
export const FITBOX_CHAIN_PLAN = "1";
export const FITBOX_ESCROW_BALANCE = 48 * 10000; // fen

export const ATTACK_PDF = "evals/cases/attacks/pdf_hidden_white_text.pdf";
export const SOFT_SIGNALS = "evals/cases/attacks/signals_injected_instructions.json";
/** Case ref of the attestation the flows insert (removed again by restorePrepaid). */
export const ATTESTATION_CASE_REF = "e2e:court-enforcement:fitbox-futian";

export function repoFile(rel: string): Uint8Array {
  return new Uint8Array(readFileSync(path.join(process.cwd(), rel)));
}

export function repoJson<T>(rel: string): T {
  return JSON.parse(readFileSync(path.join(process.cwd(), rel), "utf8")) as T;
}

/**
 * Production wiring has no read tools yet (src/agent/wiring.ts, TODO(integration)). The tool
 * list is part of every Planner request, so the recordings must be made with the same list.
 */
export const LIN_READ_TOOLS: ReadTool[] = [];

// ---- Restores -----------------------------------------------------------------------------

/** Bills, caps, open approvals and the bill plans: back to the seeded "two unpaid bills" state. */
export async function restoreBills(admin: Pool): Promise<void> {
  const ids = [BILLS.power.id, BILLS.mobile.id];
  const c = await admin.connect();
  try {
    await c.query("begin");
    await c.query("update public.bills set status = 'unpaid' where user_id = $1 and id = any($2::uuid[])", [LIN, ids]);
    await c.query("update mockbank.bills set status = 'unpaid' where customer_id = $1 and id = any($2::uuid[])", [LIN, ids]);
    await c.query("delete from mockbank.transactions where payment_id in (select id from mockbank.payments where customer_id = $1)", [LIN]);
    await c.query("delete from mockbank.payments where customer_id = $1", [LIN]);
    await c.query("update mockbank.accounts set balance = $2 where id = $1", [LIN_CHECKING, LIN_CHECKING_BALANCE]);
    await c.query("delete from public.cap_reservations where user_id = $1", [LIN]);
    await c.query("delete from public.daily_limits where user_id = $1", [LIN]);
    await closeOpen(c, ["due_date", "detector", "chat"], ["pay_bill"]);
    // Documents uploaded by the attack flow (the ids are derived from their content).
    await c.query("update public.bills set document_id = null where user_id = $1 and document_id is not null", [LIN]);
    await c.query("delete from public.documents where user_id = $1", [LIN]);
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

/** The Keep Premium trial: converting in two days, keep_flag off, no notice sent yet. */
export async function restoreTrial(admin: Pool): Promise<void> {
  const c = await admin.connect();
  try {
    await c.query("begin");
    await c.query(
      `update public.subscriptions set status = 'trial', trial_end = now() + interval '2 days', keep_flag = false, notice_sent = false
        where id = $1 and user_id = $2`,
      [KEEP_TRIAL, LIN],
    );
    await c.query(
      "update mockbank.subscriptions set status = 'trial', trial_end = now() + interval '2 days', cancelled_at = null where id = $1",
      [KEEP_TRIAL],
    );
    await closeOpen(c, ["trial"], ["cancel_subscription"]);
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

/** FitBox plan active again with 48 sessions in escrow; no attestation on file. */
export async function restorePrepaid(admin: Pool): Promise<void> {
  const c = await admin.connect();
  try {
    await c.query("begin");
    await c.query("update public.prepaid_plans set status = 'active' where id = $1", [FITBOX_PLAN]);
    await c.query("update mockbank.escrow_plans set status = 'active', balance = $2 where chain_plan_id = $1", [
      FITBOX_CHAIN_PLAN,
      FITBOX_ESCROW_BALANCE,
    ]);
    await c.query("delete from public.attestations where merchant_id = $1 and case_ref_hash = $2", [FITBOX, ATTESTATION_CASE_REF]);
    await closeOpen(c, ["prepaid_risk"], ["prepaid_exit"]);
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

export async function restoreLin(admin: Pool): Promise<void> {
  await restoreBills(admin);
  await restoreTrial(admin);
  await restorePrepaid(admin);
}

/** Leftovers of an interrupted earlier run: open approvals, in-flight actions, paused plans. */
async function closeOpen(c: import("pg").PoolClient, triggers: string[], tools: string[]) {
  await c.query(
    `update public.approvals set status = 'expired'
      where user_id = $1 and status in ('pending','approved')
        and action_id in (select id from public.actions where user_id = $1 and tool = any($2::text[]))`,
    [LIN, tools],
  );
  await c.query(
    `update public.actions set status = 'expired'
      where user_id = $1 and tool = any($2::text[]) and status in ('planned','ready','awaiting_approval','executing')`,
    [LIN, tools],
  );
  await c.query(
    "update public.plans set status = 'failed' where user_id = $1 and trigger = any($2::text[]) and status in ('running','paused')",
    [LIN, triggers],
  );
}

// ---- Environment --------------------------------------------------------------------------

/**
 * A PostgresSaver on the "langgraph" schema, used by the app role (DATABASE_URL).
 *
 * The tables are created through the admin connection: PostgresSaver.setup() starts with
 * `CREATE SCHEMA IF NOT EXISTS`, which needs CREATE on the database, and reins_server only has
 * CREATE on the schema, so setup() as reins_server fails with 42501 (see the report for the
 * `pnpm db:checkpointer` bug). reins_server then gets read/write on the tables (local Supabase's
 * postgres role cannot hand ownership to it). An advisory lock keeps parallel test files from
 * racing on CREATE TABLE.
 */
export async function postgresCheckpointer(admin: Pool): Promise<PostgresSaver> {
  const adminUrl = process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:54322/postgres";
  const c = await admin.connect();
  try {
    await c.query("select pg_advisory_lock(hashtext('reins:test:checkpointer-setup'))");
    const setup = PostgresSaver.fromConnString(adminUrl, { schema: CHECKPOINT_SCHEMA });
    try {
      await setup.setup();
    } finally {
      await setup.end();
    }
    await c.query("grant select, insert, update, delete on all tables in schema langgraph to reins_server");
  } finally {
    await c.query("select pg_advisory_unlock(hashtext('reins:test:checkpointer-setup'))").catch(() => {});
    c.release();
  }
  return PostgresSaver.fromConnString(checkpointerConnString(), { schema: CHECKPOINT_SCHEMA });
}

export function allRoles(client: ModelClient): ModelClients {
  return { planner: client, reader: client, signal_reader: client, explainer: client, mandate_compiler: client };
}

/**
 * Documents get a content-derived id, so the Planner context (which names the document) is the
 * same on every run and the recordings match. The production repo uses gen_random_uuid().
 */
export function deterministicDocumentRepo(): DocumentRepo {
  const pg = createPgDocumentRepo();
  return {
    ...pg,
    insertIdempotent: (input) =>
      withUserTx(input.userId, async (tx) => {
        const id = seedId(`doc:${input.userId}:${input.sha256}`);
        const ins = await tx.query<{ id: string }>(
          `insert into public.documents (id, user_id, type, storage_ref, sha256, received_at, retention_until)
           values ($1, $2, $3, $4, $5, $6, $7) on conflict (user_id, sha256) do nothing returning id`,
          [id, input.userId, input.type, input.storageRef, input.sha256, input.receivedAt, input.retentionUntil],
        );
        if (ins.rows[0]) return { id: ins.rows[0].id, created: true };
        const existing = await tx.query<{ id: string }>("select id from public.documents where user_id = $1 and sha256 = $2", [
          input.userId,
          input.sha256,
        ]);
        return { id: existing.rows[0].id, created: false };
      }),
  };
}

const EMPTY_SIGNALS = (merchantId: string): SignalBundle => ({ merchantId, complaints: [], news: [] });

export type LinEnv = RunEnv & {
  executor: ActionExecutor;
  store: PgPlanStore;
  repo: DocumentRepo;
  storage: ReturnType<typeof createLocalDocumentStorage>;
  /** What the registry simulator returns for the next Signal Reader run. */
  signals: { bundle: SignalBundle | null };
};

/** The app's wiring (src/agent/wiring.ts) with the mock bank in process and the given models. */
export function createLinEnv(opts: { models: ModelClients; saver: PostgresSaver; storageDir?: string }): LinEnv {
  const executor = createExecutor({ transport: inProcessTransport });
  const store = new PgPlanStore(executor);
  const repo = deterministicDocumentRepo();
  const storage = createLocalDocumentStorage(opts.storageDir ?? mkdtempSync(path.join(tmpdir(), "reins-e2e-docs-")));
  const signals: LinEnv["signals"] = { bundle: null };
  const deps: AgentDeps = {
    models: opts.models,
    readTools: LIN_READ_TOOLS,
    store,
    executor,
    reader: createDocumentReader({ models: opts.models, loadDocument: createDocumentLoader({ repo, storage }) }),
    signalReader: createSignalReader({
      models: opts.models,
      fetchSignals: async (merchantId) => signals.bundle ?? EMPTY_SIGNALS(merchantId),
    }),
    now: () => new Date().toISOString(),
  };
  return { graph: compileGraph(opts.saver), deps, plans: pgPlanRegistry, executor, store, repo, storage, signals };
}

// ---- Flows (the demo path, task.md §9) ----------------------------------------------------

export async function drain(events: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

export type FlowResult = { planId: string; events: ChatStreamEvent[]; feed: string[]; approvalId: string | null };

export function summarize(events: ChatStreamEvent[]): FlowResult {
  const plan = events.find((e) => e.type === "plan");
  const approval = events.find((e) => e.type === "approval_required");
  return {
    planId: plan?.type === "plan" ? plan.planId : "",
    events,
    feed: events.flatMap((e) => (e.type === "feed" ? [e.text] : [])),
    approvalId: approval?.type === "approval_required" ? approval.approvalId : null,
  };
}

/** cron/due-dates: a bill is due, the agent plans for it. */
export async function billDueFlow(env: LinEnv, billId: string): Promise<FlowResult> {
  return summarize(await drain(startPlan({ userId: LIN, trigger: "due_date", subjectId: billId }, env)));
}

/**
 * /api/ingest/upload: store the PDF, insert the document row, then start the plan that runs the
 * quarantined Reader on it (src/server/ingest/on-document.ts, with this env instead of the
 * process-wide one).
 */
export async function uploadFlow(env: LinEnv, bytes: Uint8Array): Promise<FlowResult & { ingest: IngestResult }> {
  let events: ChatStreamEvent[] = [];
  const ingest = await ingestUpload(
    { userId: LIN, bytes },
    {
      repo: env.repo,
      storage: env.storage,
      onDocument: async (documentId, userId) => {
        events = await drain(startPlan({ userId, trigger: "document", subjectId: documentId, documentIds: [documentId] }, env));
      },
    },
  );
  return { ...summarize(events), ingest };
}

/** cron/trials: the notice went out (notify step), then the auto-cancel run for the trial. */
export async function trialFlow(env: LinEnv, admin: Pool): Promise<FlowResult> {
  await admin.query("update public.subscriptions set notice_sent = true where id = $1 and user_id = $2", [KEEP_TRIAL, LIN]);
  return summarize(await drain(startPlan({ userId: LIN, trigger: "trial", subjectId: KEEP_TRIAL }, env)));
}

/**
 * The registry publishes a court-enforcement record and the oracle signs it (the sim's job),
 * then cron/risk runs the agent for the merchant. No soft signals in this run.
 */
export async function attestedExitFlow(env: LinEnv, admin: Pool): Promise<FlowResult> {
  await admin.query(
    `insert into public.attestations (merchant_id, kind, case_ref_hash, issued_at, expires_at, signer, signature, sig_valid, raw_json)
     values ($1, 'court_enforcement', $2, now() - interval '1 hour', now() + interval '30 days', $3, 'mock:oracle-signature', true, '{}')
     on conflict (merchant_id, kind, case_ref_hash) do update set issued_at = excluded.issued_at, expires_at = excluded.expires_at`,
    [FITBOX, ATTESTATION_CASE_REF, process.env.ORACLE_ADDRESS ?? ""],
  );
  env.signals.bundle = null;
  return summarize(await drain(startPlan({ userId: LIN, trigger: "prepaid_risk", subjectId: FITBOX_PLAN }, env)));
}

/** Lin taps Approve (POST /api/approvals/:id), and the handler resumes the plan. */
export async function approveAndResume(env: LinEnv, flow: FlowResult): Promise<ResumeResponse> {
  if (!flow.approvalId) throw new Error("flow has no approval to decide");
  await decideApproval(LIN, flow.approvalId, "approve");
  return resumePlan({ planId: flow.planId, userId: LIN }, env);
}

/** Every flow of the demo path that calls a model, in shot-list order, from a restored Lin. */
export async function runDemoPath(env: LinEnv, admin: Pool, log: (name: string, r: FlowResult | ResumeResponse) => void = () => {}) {
  await restoreLin(admin);
  log("bill attack (upload)", await uploadFlow(env, repoFile(ATTACK_PDF)));
  await restoreBills(admin);
  const anomalous = await billDueFlow(env, BILLS.power.id);
  log("anomalous bill (plan)", anomalous);
  log("anomalous bill (approve + resume)", await approveAndResume(env, anomalous));
  await restoreBills(admin);
  log("normal bill", await billDueFlow(env, BILLS.mobile.id));
  log("trial auto-cancel", await trialFlow(env, admin));
  log("attested prepaid exit", await attestedExitFlow(env, admin));
  log("soft signal warning", await softSignalFlow(env));
  await restoreLin(admin);
}

/** A fake complaint with injected instructions arrives for the merchant: warning only. */
export async function softSignalFlow(env: LinEnv): Promise<FlowResult> {
  env.signals.bundle = repoJson<SignalBundle>(SOFT_SIGNALS);
  try {
    return summarize(await drain(startPlan({ userId: LIN, trigger: "prepaid_risk", subjectId: FITBOX_PLAN }, env)));
  } finally {
    env.signals.bundle = null;
  }
}
