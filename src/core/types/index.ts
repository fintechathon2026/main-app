// Shared core types. Owner: R2 (roles.md §4). Minimal version written by R1 to unblock the
// agent; R2 may extend or reshape it, but changes need the owner's review.
// Sources: architecture §6.2, §7.1, §24.9; PRD §10.

export type Origin =
  | "user"
  | "registry"
  | "mock_bank"
  | "aggregator"
  | "fx_provider"
  | "chain"
  | "oracle"
  | "email"
  | "document"
  | "notification"
  | "csv"
  | "web"
  | "simulated";

/** Untrusted origins can inform proposals but never authorize or route money (G2). */
export const UNTRUSTED_ORIGINS: readonly Origin[] = ["email", "document", "notification", "csv", "web"];

export type Labeled<T> = { value: T; origin: Origin; sourceId?: string };

export type Trigger =
  | "chat"
  | "due_date"
  | "payday"
  | "renewal"
  | "trial"
  | "detector"
  | "digest"
  | "prepaid_risk"
  | "chain_event"
  | "user_action";

export type Actor = "agent" | "user";

// ---- Actions -------------------------------------------------------------

export type ActionTool =
  | "pay_bill"
  | "cancel_subscription"
  | "sweep_to_savings"
  | "prepaid_purchase"
  | "prepaid_redeem"
  | "prepaid_exit"
  | "prepaid_exit_voluntary";

/** Tools the Planner may call; they are captured, never executed by the graph. */
export const AGENT_ACTION_TOOLS = ["pay_bill", "cancel_subscription", "prepaid_exit"] as const;
export type AgentActionTool = (typeof AGENT_ACTION_TOOLS)[number];

export type PayBillArgs = { bill_id: string; biller_id: string; amount: number };
export type CancelSubscriptionArgs = { subscription_id: string };
export type PrepaidExitArgs = { plan_id: string };
export type SweepToSavingsArgs = { amount: number };

export type TypedAction =
  | { tool: "pay_bill"; actor: "agent"; args: PayBillArgs }
  | { tool: "cancel_subscription"; actor: "agent"; args: CancelSubscriptionArgs }
  | { tool: "sweep_to_savings"; actor: "agent"; args: SweepToSavingsArgs }
  | { tool: "prepaid_exit"; actor: "agent"; args: PrepaidExitArgs }
  | { tool: "prepaid_purchase"; actor: "user"; args: { offer_id: string } }
  | { tool: "prepaid_redeem"; actor: "user"; args: { plan_id: string; session_no: number } }
  | { tool: "prepaid_exit_voluntary"; actor: "user"; args: { plan_id: string } };

export type ActionStatus =
  | "planned"
  | "ready"
  | "awaiting_approval"
  | "denied"
  | "rejected"
  | "expired"
  | "executing"
  | "succeeded"
  | "failed"
  | "unknown"
  | "cancelled_replan";

// ---- Gate ------------------------------------------------------------------

export type Decision = "allow" | "require_confirm" | "deny";

export type RuleTrace = { ruleId: string; result: Decision; reason?: string };

export type GateResult = {
  decision: Decision;
  ruleIds: string[];
  reasons: string[]; // template keys + params, rendered by UI
  mandateVersion: number;
  mandateHash: string;
  amountBase: number; // FX-converted amount used for caps
  trace: RuleTrace[];
};

export type ProvenanceFacts = {
  destinationOrigin: Origin | null; // must be "registry"
  amountOrigin: Origin | null; // bill row origin
  amountMatchesBill: boolean;
  trialStatusOrigin?: Origin | null;
};

export type PrepaidFacts = {
  actor: Actor;
  ownerWallet: string | null;
  plan: {
    owner: string;
    merchant: string;
    agent: string | null;
    status: "active" | "completed" | "exited_attested" | "exited_voluntary";
    unitPrice: number;
    unitsLeft: number;
    nextSession: number;
  } | null;
  offer?: {
    merchantSigValid: boolean;
    expired: boolean;
    termsMatchStored: boolean;
    escrowSupported: boolean;
    totalBase: number;
  };
  consumerSigValid?: boolean;
  merchantSigValid?: boolean;
  sessionNo?: number;
  attestation?: {
    signerIsOracle: boolean;
    kind: "court_enforcement" | "closure_notice";
    merchantMatches: boolean;
    ageDays: number;
    expired: boolean;
  } | null;
  agentIsOurs?: boolean;
};

export type GateSnapshot = {
  now: string; // injected clock (ISO)
  killSwitch: boolean;
  mandate: { version: number; hash: string; policy: unknown; signatureValid: boolean } | null;
  provenance: ProvenanceFacts;
  payee: { billerId: string; inRegistry: boolean; verified: boolean } | null;
  history: { amounts: number[] };
  fx: { rate: number; date: string; source: "fx_provider" } | null;
  caps: { dailyUsed: number; dailyCap: number; perPayeeUsed?: number; perPayeeCap?: number };
  approval: { valid: boolean; reason?: string } | null;
  subscription?: {
    status: string;
    isTrial: boolean;
    trialOrigin: Origin | null;
    keepFlag: boolean;
    noticeSent: boolean;
  };
  prepaid?: PrepaidFacts;
};

// ---- Executor --------------------------------------------------------------

export type ExecResult = {
  actionId: string;
  status: ActionStatus;
  gate?: GateResult;
  replan?: boolean;
  result?: unknown;
  error?: string;
};

/** Implemented by R2 in src/server/executor. Only the agent's `execute` node calls it. */
export interface ActionExecutorPort {
  run(actionId: string, userId: string): Promise<ExecResult>;
}
