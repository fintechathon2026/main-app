// API response types for UI routes (roles.md §1.1, §4). R4 builds against these plus the JSON
// fixtures in fixtures/api/. Each section names its route owner. Amounts are integers in the
// user's base currency (yuan for Lin) unless a field says otherwise.

import type { Policy } from "@/src/core/mandate/schema";
import type { Origin } from "@/src/core/types";
import type { Policy as DraftPolicy } from "@/src/server/mandate/schema";

export type Money = { amount: number; currency: string };
/** A foreign amount with its base-currency equivalent and rate date (PRD FR18.4). */
export type FxMoney = Money & { base?: Money & { rate: number; rateDate: string } };

export type SourceRef = { origin: Origin; sourceId?: string; simulated?: boolean };

// ---- R1: GET /api/summary?period=YYYY-MM -----------------------------------------------

export type SummaryResponse = {
  period: string;
  baseCurrency: string;
  income: Money;
  spending: Money;
  byCategory: { category: string; amount: Money; transactionIds: string[] }[];
  recurring: { bills: Money; subscriptions: Money };
  upcoming14d: {
    kind: "bill" | "renewal" | "trial_conversion" | "prepaid_session";
    title: string;
    dueDate: string;
    amount: FxMoney;
    refId: string;
  }[];
  balance: Money;
  balanceAfterObligations: Money;
  insights: { key: string; text: string; amount?: Money; refIds: string[] }[];
};

// ---- R1: GET /api/subscriptions ---------------------------------------------------------

export type SubscriptionItem = {
  id: string;
  merchant: { id: string; name: string; category: string };
  status: "active" | "inactive" | "cancelled" | "trial";
  cycleDays: number;
  amount: FxMoney;
  nextRenewal: string | null;
  trial: { endsAt: string; autoCancelAt: string | null; keepFlag: boolean; origin: Origin } | null;
  priceChange: { from: Money; to: Money; at: string } | null;
  usage: { lastUsedAt: string | null; sessionsPerMonth: number | null; source: SourceRef } | null; // null = no usage data
  annualCost: Money;
  confidence: number;
  detectionSource: "mock_bank" | "manual" | "email" | "csv";
};
export type SubscriptionsResponse = { baseCurrency: string; items: SubscriptionItem[] };

// ---- R1: GET /api/recommendations -------------------------------------------------------

export type RecommendationSignal = {
  key: "duplicate" | "price_increase" | "trial_converted" | "low_usage" | "fx_cost_high" | "high_share";
  points: number;
  detail: string;
  source: SourceRef;
};
export type RecommendationItem = {
  id: string;
  subscriptionId: string;
  score: number;
  signals: RecommendationSignal[];
  annualSavings: Money;
  status: "open" | "accepted" | "dismissed";
  explanation?: string; // optional LLM line, visually secondary
};
export type RecommendationsResponse = { items: RecommendationItem[] };

// ---- R1: POST /api/subscriptions/:id/keep -----------------------------------------------

export type KeepTrialResponse = { subscriptionId: string; keepFlag: true };

// ---- R1: GET /api/prepaid/plans ---------------------------------------------------------

export type ChainTxRef = { hash: string; explorerUrl: string; simulated: boolean }; // simulated = mock escrow id

export type PrepaidPlanItem = {
  id: string;
  chainPlanId: string;
  merchant: { id: string; name: string; riskLevel: "none" | "watch" | "elevated" };
  unitPrice: Money;
  unitsTotal: number;
  unitsRedeemed: number;
  balanceInEscrow: Money;
  /**
   * After an exit: what went back to the owner (unused sessions, minus the fee on a voluntary
   * exit), from the plan's stored terms. Absent while the plan is active or completed.
   */
  refund?: Money;
  cancelFeeBps: number;
  status: "active" | "completed" | "exited_attested" | "exited_voluntary";
  purchaseTx: ChainTxRef;
  sessions: { sessionNo: number; redeemedAt: string; tx: ChainTxRef }[];
  signals: PrepaidSignal[];
  testTokenNotice: string; // "Test token, no value"
};
export type PrepaidSignal = {
  tier: "hard" | "soft";
  kind: "court_enforcement" | "closure_notice" | "complaints" | "news";
  level?: "none" | "watch" | "elevated";
  summary: string;
  observedAt: string;
  source: SourceRef;
};
export type PrepaidPlansResponse = { baseCurrency: string; plans: PrepaidPlanItem[] };

// ---- R1: GET /api/prepaid/offers --------------------------------------------------------

export type PrepaidOfferItem = {
  id: string;
  merchant: { id: string; name: string; escrowSupported: boolean; riskLevel: "none" | "watch" | "elevated" };
  unitPrice: Money;
  units: number;
  total: Money;
  payPerVisitPrice: Money;
  cancelFeeBps: number;
  expiresAt: string;
  signals: PrepaidSignal[];
  simulated: true;
};
export type PrepaidOffersResponse = { offers: PrepaidOfferItem[] };

// ---- R1: GET /api/prepaid/offers/:id/advice (PRD §15.11) --------------------------------

export type PrepaidAdviceResponse = {
  offerId: string;
  savings: Money;
  breakEvenSessions: number;
  expectedSessions: number;
  closureRate: { value: number; source: "default" | "input" | "elevated_signal"; note: string };
  periodClosureProbability: number;
  expectedLossWithoutEscrow: Money;
  expectedLossWithEscrow: Money;
  escrowAvailable: boolean;
  recommendation: "pay_per_visit" | "prepay_escrow" | "prepay_with_risk";
  explanation?: string; // LLM phrasing only; every number above comes from the tool
};

// ---- R1: POST /api/chat (streamed events, newline-delimited JSON) ------------------------

export type ChatStreamEvent =
  | { type: "plan"; planId: string }
  | { type: "token"; text: string }
  | { type: "status"; node: string; detail?: string }
  | { type: "approval_required"; planId: string; approvalId: string } // card itself comes from /api/approvals
  | { type: "feed"; text: string }
  | { type: "done"; planId: string; route: "execute" | "approve" | "deny" | "none" }
  | { type: "error"; message: string };

// ---- R1: POST /api/agent/resume ---------------------------------------------------------

export type ResumeResponse = { planId: string; status: "done" | "paused" | "failed"; feed: string[] };

// ---- R3: GET|POST /api/kill-switch ------------------------------------------------------

export type KillSwitchResponse = { enabled: boolean; changedAt: string | null };

// ---- R3: GET|PATCH /api/settings --------------------------------------------------------

export type SettingsResponse = {
  profile: { email: string | null; displayName: string | null; locale: string; timezone: string; baseCurrency: string };
  killSwitch: KillSwitchResponse;
  mandateVersion: number | null;
  dataSources: { id: string; type: string; status: "active" | "paused" | "revoked"; lastSyncedAt: string | null }[];
};
/** baseCurrency is not editable here: it is bound to the signed mandate (G6). */
export type SettingsUpdateRequest = { displayName?: string; locale?: string; timezone?: string };

// ---- R3: POST /api/admin/run-now ----------------------------------------------------------

export type CronJob = "fx" | "detect" | "risk" | "cleanup" | "chain-sync";
export type RunNowResponse = { job: CronJob; ok: boolean; scope: "user" | "global"; ranAt: string; stats: Record<string, unknown> };

// ---- R3: GET /api/audit/export?format=jsonl|csv (one entry per line / row) ----------------

export type AuditExportEntry = {
  seq: number;
  createdAt: string;
  actor: "agent" | "user" | "gate" | "system";
  eventType: string;
  prevHash: string;
  hash: string;
  event: Record<string, unknown>;
};

export type ApiError = { error: string; code?: string };

// ---- R2: shared UI status ------------------------------------------------------------------

/** Plain-language outcome shown on feed and evidence rows (docs/ui-direction.md §5). */
export type UiStatus = "done" | "ask" | "suggest" | "blocked";

// ---- R2: GET /api/feed, GET /api/feed/:id/why -----------------------------------------------

/** One step of the Gate's recorded rule check, in plain words. Built from the stored trace. */
export type FeedCheck = { label: string; passed: boolean };

/**
 * One thing Reins did or tried (an `actions` row that reached a decision). Every sentence is a
 * template filled from stored ids and registry names; no model text (G6). `id` is the action id.
 */
export type FeedItem = {
  id: string;
  at: string;
  status: UiStatus;
  title: string;
  detail: string;
  amount?: Money;
  ruleIds: string[];
  mandateVersion: number;
  origins: { origin: Origin; label: string; simulated?: boolean }[];
  /** The "Rule check" steps, in the order the Gate ran them. */
  checks: FeedCheck[];
  tx?: { hash: string; explorerUrl: string };
};
/** Newest first. A bare array, like the Activity screen's stand-in. */
export type FeedResponse = FeedItem[];

export type FeedWhyResponse = {
  id: string;
  status: UiStatus;
  decision: "allow" | "require_confirm" | "deny" | null;
  mandateVersion: number;
  /** Hash of the mandate the decision used (from the stored Gate result); null if none was stored. */
  mandateHash: string | null;
  ruleIds: string[];
  checks: FeedCheck[];
};

// ---- R2: GET /api/mandates/active, GET /api/mandates/history --------------------------------

/** The signed mandate in force: the Mandate Card's data. `policy` has every default applied. */
export type MandateActiveResponse = {
  version: number;
  /** sha256 of the canonical stored policy, 64 lowercase hex. */
  hash: string;
  signedAt: string;
  createdVia: "nl" | "template" | "edit";
  policy: Policy;
};

export type MandateVersion = {
  version: number;
  signedAt: string;
  /** One plain sentence built from the difference between this and the previous policy. */
  change: string;
  /**
   * Less or more permission than the previous version. null = not classified yet: the live route
   * returns null until compareMandates (src/core/mandate/narrow.ts) is wired in.
   */
  direction: "less" | "more" | "first" | null;
  status: "active" | "superseded" | "revoked";
};
/** Newest first, like the Rules screen's stand-in. */
export type MandateHistoryResponse = MandateVersion[];

// ---- R2: POST /api/mandates/compile ----------------------------------------------------------

export type MandateCompileRequest = { text: string };
/**
 * A draft only: nothing is saved, signed or activated by this route. `readback` is generated from
 * `policy` by templates (never model text); `defaulted` lists fields the user did not mention,
 * which took their most restrictive value. The policy has no `version`: activation assigns it.
 * TODO(R2): add the diff against the active mandate and its less/more class (compareMandates).
 */
export type MandateCompileResponse = {
  baseCurrency: "CNY" | "IDR";
  policy: DraftPolicy;
  defaulted: string[];
  readback: string[];
};

// ---- R2: GET /api/audit/verify ------------------------------------------------------------

/** One audit entry as the Evidence screen shows it. `event` is a template sentence, never model text. */
export type AuditVerifyRow = {
  seq: number;
  at: string;
  event: string;
  /** The gate and the agent both show as "agent" (Reins); the raw actor is in /api/audit/export. */
  actor: "agent" | "user" | "system";
  status: UiStatus | null; // null = not a decision (e.g. rules signed)
  ruleIds: string[];
  /** Entry hash, 64 lowercase hex (no 0x). */
  hash: string;
  tx?: { hash: string; explorerUrl: string };
};
export type AuditVerifyResponse = {
  chainOk: boolean;
  checkedAt: string;
  /** Entries in the whole chain (rows[] is only the newest page). */
  count: number;
  firstBreakSeq: number | null;
  /** Newest first. */
  rows: AuditVerifyRow[];
};
