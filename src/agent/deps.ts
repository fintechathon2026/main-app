// Dependencies injected into the graph through `config.configurable.deps`, so every node can run
// against fakes in tests and against real implementations (owned by R2/R3) in the app.

import type { ActionExecutorPort, GateResult, Labeled } from "@/src/core/types";
import type { ModelClient, ModelRole } from "./models/types";
import type { ReadTool } from "./tools/types";
import type { SignalWarning } from "./state";

export type ModelClients = Record<ModelRole, ModelClient>;

export interface PlanStore {
  /** Insert action rows (upsert on idempotency_key); returns ids in order. */
  persistActions(input: {
    planId: string;
    userId: string;
    mandateVersion: number;
    actions: { tool: string; args: Record<string, unknown>; argsHash: string; idempotencyKey: string }[];
  }): Promise<string[]>;
  loadContext(userId: string): Promise<{ mandateVersion: number | null; mandateHash: string | null; killSwitch: boolean }>;
  /** Dry-run Gate decision for routing only; not a security boundary (architecture §6.3). */
  previewDecision(actionId: string, userId: string): Promise<GateResult>;
  createApproval(actionId: string, userId: string): Promise<string>;
  recordDeny(actionIds: string[], userId: string): Promise<void>;
  auditRowsForPlan(planId: string, userId: string): Promise<AuditRow[]>;
}

export type AuditRow = {
  actionId: string;
  tool: string;
  decision: string;
  ruleIds: string[];
  mandateVersion: number;
  payeeName?: string;
  amount?: number;
  currency?: string;
  txHash?: string;
};

export interface DocumentReaderPort {
  /** Runs the quarantined Reader on one document; every field labeled origin=document. */
  read(documentId: string, userId: string): Promise<Labeled<unknown>[]>;
}

export interface SignalReaderPort {
  /** Runs the quarantined Signal Reader for one merchant; output is a warning only. */
  read(merchantId: string): Promise<Labeled<SignalWarning> | null>;
}

export type AgentDeps = {
  models: ModelClients;
  readTools: ReadTool[];
  store: PlanStore;
  executor: ActionExecutorPort;
  reader: DocumentReaderPort;
  signalReader: SignalReaderPort;
  now: () => string;
};
