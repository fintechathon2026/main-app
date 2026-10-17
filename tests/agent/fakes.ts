// Test doubles for the agent graph: an in-memory PlanStore and ActionExecutor that mimic the
// Postgres-side authority (approvals, Gate, idempotency), scripted model clients, and a helper
// that records a scripted run and replays it through RecordedModelClient.

import { MemorySaver } from "@langchain/langgraph";
import { z } from "zod";
import type { ActionExecutorPort, Decision, ExecResult, GateResult, Labeled } from "@/src/core/types";
import type { AgentDeps, AuditRow, DocumentReaderPort, ModelClients, PlanStore, SignalReaderPort } from "@/src/agent/deps";
import { compileGraph, type AgentGraph } from "@/src/agent/graph";
import { RecordedModelClient } from "@/src/agent/models/recorded";
import { RecordingModelClient } from "@/src/agent/models/recording";
import type { Recording } from "@/src/agent/models/recording-key";
import type { ChatRequest, ChatResponse, ModelClient, ModelRole, StructuredRequest } from "@/src/agent/models/types";
import type { ReadTool, ToolContext } from "@/src/agent/tools/types";
import type { SignalWarning } from "@/src/agent/state";

export const USER = "11111111-1111-4111-8111-111111111111";
export const PLAN = "22222222-2222-4222-8222-222222222222";

type ActionRow = {
  id: string;
  planId: string;
  userId: string;
  tool: string;
  args: Record<string, unknown>;
  argsHash: string;
  idempotencyKey: string;
  mandateVersion: number;
  status: string;
};

export class FakeWorld {
  // Database-side state
  mandate: { version: number; hash: string } | null = { version: 3, hash: "mh3" };
  killSwitch = false;
  actions: ActionRow[] = [];
  approvals = new Map<string, { actionId: string; status: "pending" | "approved" | "consumed" }>();
  audit: AuditRow[] = [];
  prepaidPlans = new Map<string, string>([["plan_fitbox", "FITBOX_FUTIAN"]]); // prepaid plan id -> merchant id
  denies: string[][] = [];
  /** What the (fake) Gate decides per tool, now. */
  gate: Record<string, Decision> = { pay_bill: "allow", cancel_subscription: "require_confirm", prepaid_exit: "allow" };
  /** Settlement calls, keyed by idempotency key: the money side effect. */
  settlements: string[] = [];
  /** Executor calls, with the stack of the caller. */
  executorCalls: { actionId: string; userId: string; stack: string }[] = [];
  /** Makes the next N executor runs ask for a re-plan (mandate changed). */
  replanNext = 0;
  readToolCalls: { args: unknown; ctx: ToolContext }[] = [];

  store: PlanStore = {
    persistActions: async ({ planId, userId, mandateVersion, actions }) =>
      actions.map((a) => {
        const existing = this.actions.find((r) => r.idempotencyKey === a.idempotencyKey);
        if (existing) return existing.id;
        const row: ActionRow = { id: `act-${this.actions.length + 1}`, planId, userId, mandateVersion, status: "planned", ...a };
        this.actions.push(row);
        return row.id;
      }),
    loadContext: async () => ({
      mandateVersion: this.mandate?.version ?? null,
      mandateHash: this.mandate?.hash ?? null,
      killSwitch: this.killSwitch,
    }),
    previewDecision: async (actionId) => this.gateResult(this.row(actionId).tool),
    createApproval: async (actionId) => {
      const id = `appr-${this.approvals.size + 1}`;
      this.approvals.set(id, { actionId, status: "pending" });
      return id;
    },
    recordDeny: async (actionIds) => {
      this.denies.push(actionIds);
      for (const id of actionIds) this.auditRow(this.row(id), "deny");
    },
    prepaidPlanMerchant: async (planId) => this.prepaidPlans.get(planId) ?? null,
    auditRowsForPlan: async (planId, userId) =>
      this.audit.filter((r) => this.actions.some((a) => a.id === r.actionId && a.planId === planId && a.userId === userId)),
  };

  executor: ActionExecutorPort = {
    run: async (actionId: string, userId: string): Promise<ExecResult> => {
      this.executorCalls.push({ actionId, userId, stack: new Error().stack ?? "" });
      const row = this.row(actionId);
      if (row.userId !== userId) return { actionId, status: "failed", error: "not_found" };
      if (row.status === "succeeded") return { actionId, status: "succeeded" };
      if (this.replanNext > 0) {
        this.replanNext--;
        row.status = "cancelled_replan";
        return { actionId, status: "cancelled_replan", replan: true };
      }
      let decision = this.gate[row.tool] ?? "deny";
      if (decision === "require_confirm") {
        // Authority comes only from the approval row in "Postgres", never from a resume payload.
        const appr = [...this.approvals.values()].find((a) => a.actionId === actionId && a.status === "approved");
        if (appr) {
          appr.status = "consumed";
          decision = "allow";
        }
      }
      if (decision !== "allow") {
        row.status = decision === "deny" ? "denied" : "awaiting_approval";
        this.auditRow(row, decision);
        return { actionId, status: row.status as ExecResult["status"] };
      }
      this.settlements.push(row.idempotencyKey);
      row.status = "succeeded";
      this.auditRow(row, "allow", "0xabcdef1234567890");
      return { actionId, status: "succeeded" };
    },
  };

  approveAll() {
    for (const a of this.approvals.values()) if (a.status === "pending") a.status = "approved";
  }

  private row(id: string): ActionRow {
    const r = this.actions.find((a) => a.id === id);
    if (!r) throw new Error(`no action ${id}`);
    return r;
  }

  private gateResult(tool: string): GateResult {
    const decision = this.gate[tool] ?? "deny";
    return {
      decision,
      ruleIds: [ruleFor(tool)],
      reasons: [],
      mandateVersion: this.mandate?.version ?? 0,
      mandateHash: this.mandate?.hash ?? "",
      amountBase: 0,
      trace: [],
    };
  }

  private auditRow(row: ActionRow, decision: string, txHash?: string) {
    this.audit.push({
      actionId: row.id,
      tool: row.tool,
      decision,
      ruleIds: [ruleFor(row.tool)],
      mandateVersion: row.mandateVersion,
      payeeName: row.tool === "pay_bill" ? "SZ Power" : undefined,
      amount: typeof row.args.amount === "number" ? row.args.amount : undefined,
      currency: typeof row.args.amount === "number" ? "CNY" : undefined,
      txHash,
    });
  }
}

function ruleFor(tool: string): string {
  return tool === "pay_bill" ? "bills.auto_pay_max" : tool === "cancel_subscription" ? "subscriptions.cancel" : "prepaid.auto_exit_on";
}

export function listBillsTool(world: FakeWorld): ReadTool {
  const argsSchema = z.object({ status: z.enum(["open", "paid"]).optional() }).strict();
  return {
    spec: { name: "list_bills", description: "List the user's bills.", inputSchema: z.toJSONSchema(argsSchema) as Record<string, unknown> },
    argsSchema: argsSchema as z.ZodType<Record<string, unknown>>,
    run: async (args, ctx) => {
      world.readToolCalls.push({ args, ctx });
      const bills: Labeled<unknown>[] = [
        { value: { bill_id: "bill_1", biller_id: "SZ_POWER", amount: 120, due: "2026-10-20" }, origin: "mock_bank", sourceId: "bill_1" },
      ];
      return bills;
    },
  };
}

/** Replays a fixed sequence of responses per role and keeps every request it saw. */
export class ScriptedModelClient implements ModelClient {
  readonly requests: ChatRequest[] = [];
  constructor(private readonly script: Partial<Record<ModelRole, (ChatResponse | Error)[]>>) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.requests.push(structuredClone(req));
    const next = this.script[req.role]?.shift();
    if (!next) throw new Error(`ScriptedModelClient: no scripted ${req.role} response left`);
    if (next instanceof Error) throw next;
    return next;
  }

  async structured<T>(req: StructuredRequest<T>): Promise<T> {
    throw new Error(`ScriptedModelClient: structured not scripted (${req.role})`);
  }
}

export function allRoles(client: ModelClient): ModelClients {
  return { planner: client, reader: client, signal_reader: client, explainer: client, mandate_compiler: client };
}

/** A ModelClient that remembers requests while delegating to another client. */
export class SpyModelClient implements ModelClient {
  readonly requests: ChatRequest[] = [];
  constructor(private readonly inner: ModelClient) {}
  async chat(req: ChatRequest) {
    this.requests.push(structuredClone(req));
    return this.inner.chat(req);
  }
  structured<T>(req: StructuredRequest<T>) {
    return this.inner.structured(req);
  }
}

export type Harness = {
  world: FakeWorld;
  graph: AgentGraph;
  deps: AgentDeps;
  models: SpyModelClient;
  config: { configurable: { thread_id: string; deps: AgentDeps }; recursionLimit: number };
};

const noReader: DocumentReaderPort = { read: async () => [], markStatus: async () => {} };
const noSignals: SignalReaderPort = { read: async () => null };

export type HarnessOptions = {
  setup?: (w: FakeWorld) => void;
  reader?: DocumentReaderPort;
  signalReader?: (w: FakeWorld) => SignalReaderPort;
};

function makeHarness(client: ModelClient, opts: HarnessOptions): Harness {
  const world = new FakeWorld();
  opts.setup?.(world);
  const models = new SpyModelClient(client);
  const deps: AgentDeps = {
    models: allRoles(models),
    readTools: [listBillsTool(world)],
    store: world.store,
    executor: world.executor,
    reader: opts.reader ?? noReader,
    signalReader: opts.signalReader?.(world) ?? noSignals,
    now: () => "2026-10-17T00:00:00.000Z",
  };
  const graph = compileGraph(new MemorySaver());
  return { world, graph, deps, models, config: { configurable: { thread_id: PLAN, deps }, recursionLimit: 80 } };
}

/**
 * Runs `scenario` once against a scripted model wrapped in RecordingModelClient, then again
 * from scratch against RecordedModelClient built from those inline recordings. Returns the
 * replay harness, so assertions run against the recorded path.
 */
export async function recordThenReplay(
  script: Partial<Record<ModelRole, (ChatResponse | Error)[]>>,
  scenario: (h: Harness) => Promise<void>,
  opts: HarnessOptions = {},
): Promise<Harness> {
  const recordings: Recording[] = [];
  const recorder = new RecordingModelClient(new ScriptedModelClient(script), (r) => recordings.push(r));
  await scenario(makeHarness(recorder, opts));
  const replay = makeHarness(new RecordedModelClient({ recordings, source: "inline test recordings" }), opts);
  await scenario(replay);
  return replay;
}

export function harnessWith(client: ModelClient, opts: HarnessOptions = {}): Harness {
  return makeHarness(client, opts);
}

export function initialInput(message: string, extra: Partial<{ documentIds: string[]; trigger: string; subjectId: string }> = {}) {
  return {
    userId: USER,
    planId: PLAN,
    trigger: (extra.trigger ?? "chat") as "chat",
    subjectId: extra.subjectId ?? null,
    documentIds: extra.documentIds ?? [],
    messages: message ? [{ role: "user" as const, content: message }] : [],
  };
}

export const warningOf = (summary: string): Labeled<SignalWarning> => ({
  value: { level: "watch", summary, sourceIds: ["sig_1"] },
  origin: "web",
});
