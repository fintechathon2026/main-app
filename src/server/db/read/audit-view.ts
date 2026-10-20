// Owner: R2 (roles.md). Evidence rows for GET /api/audit/verify (architecture §13, §15.2).
// Pure: turns stored audit entries into the sentences the Evidence screen shows. Every word comes
// from a template keyed by `event_type` and from stored ids; no model text and no free text from
// the event body reaches the row (G6, G7). Unknown event types fall back to a neutral sentence.

import type { AuditVerifyResponse, AuditVerifyRow, UiStatus } from "../../api-types";
import { txLink } from "./db";

/** Shape of one stored audit entry (same as the export entry, `createdAt` ISO). */
export type AuditEntry = {
  seq: number;
  createdAt: string;
  actor: "agent" | "user" | "gate" | "system";
  eventType: string;
  hash: string;
  event: Record<string, unknown>;
};

/** What `verifyAuditChain` reports (src/server/audit). */
export type ChainCheck = { ok: boolean; count: number; firstBreakSeq: number | null };

const TOOL: Record<string, string> = {
  pay_bill: "pay bill",
  cancel_subscription: "cancel subscription",
  sweep_to_savings: "move to savings",
  prepaid_purchase: "buy prepaid package",
  prepaid_redeem: "use a prepaid session",
  prepaid_exit: "leave prepaid package",
  prepaid_exit_voluntary: "leave prepaid package",
};
export const toolLabel = (tool: unknown): string => (typeof tool === "string" && TOOL[tool]) || "action";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

const DECISION_STATUS: Record<string, UiStatus> = { allow: "done", require_confirm: "ask", deny: "blocked" };

type Described = { event: string; status: UiStatus | null; ruleIds: string[]; tx?: { hash: string; explorerUrl: string } };

/** Sentence, outcome, rule ids and chain link for one entry. */
export function describeAudit(e: Pick<AuditEntry, "eventType" | "event">): Described {
  const d = e.event;
  const what = toolLabel(d.tool);
  switch (e.eventType) {
    case "decision": {
      const result = rec(d.result);
      const decision = typeof result.decision === "string" ? result.decision : "";
      const status = DECISION_STATUS[decision] ?? null;
      const checked = d.phase === "preview" ? "Checked" : "Decided";
      const verb = decision === "allow" ? "allowed" : decision === "require_confirm" ? "needs your OK" : decision === "deny" ? "blocked" : "checked";
      return { event: `${checked}: ${what} ${verb}`, status, ruleIds: strs(result.ruleIds) };
    }
    case "execution.succeeded":
    case "execution.failed":
    case "execution.unknown": {
      const ok = e.eventType === "execution.succeeded";
      const out: Described = {
        event: ok ? `Done: ${what}` : e.eventType === "execution.failed" ? `Did not complete: ${what}` : `Result unknown: ${what}`,
        status: ok ? "done" : null,
        ruleIds: [],
      };
      const tx = txLink(rec(d.result).txHash);
      if (tx) out.tx = tx;
      return out;
    }
    case "mandate.activated": {
      // TODO(R2): confirm the event name and `version` field once src/server/mandate/activate lands.
      const v = d.version;
      return { event: typeof v === "number" ? `Rules signed (version ${v})` : "Rules signed", status: null, ruleIds: [] };
    }
    case "approval.created":
      return { event: "Asked for your OK", status: "ask", ruleIds: [] };
    case "approval.approved":
      return { event: "You approved an action", status: null, ruleIds: [] };
    case "approval.rejected":
      return { event: "You declined an action", status: null, ruleIds: [] };
    case "approval.expired":
      return { event: "An approval request expired", status: null, ruleIds: [] };
    case "plan.persisted":
      return { event: "Reins prepared an action", status: null, ruleIds: [] };
    case "plan.denied":
      return { event: "A planned action was blocked", status: "blocked", ruleIds: [] };
    case "plan.expired":
      return { event: "A plan expired without a decision", status: null, ruleIds: [] };
    case "kill_switch.changed":
      return { event: d.enabled === true ? "You paused everything" : "You resumed Reins", status: null, ruleIds: [] };
    case "settings.changed":
      return { event: "You changed your settings", status: null, ruleIds: [] };
    case "risk.exit_triggered":
      return { event: "Official notice found: leaving a prepaid package", status: "done", ruleIds: ["prepaid.auto_exit_on"] };
    case "risk.exit_trigger_released":
      return { event: "Exit from a prepaid package was withdrawn", status: null, ruleIds: [] };
    case "risk.warning":
      return { event: "Warning sign noted for a prepaid merchant", status: "suggest", ruleIds: ["prepaid.warn_on_soft_signals"] };
    case "prepaid.exit_signature_recorded":
      return { event: "You signed to leave a prepaid package", status: null, ruleIds: [] };
    case "executor.hash_mismatch":
      return { event: "Blocked: the action no longer matched what was checked", status: "blocked", ruleIds: [] };
    case "executor.consumer_signature_invalid":
      return { event: "Blocked: your signature did not match", status: "blocked", ruleIds: ["executor.consumer_signature_invalid"] };
    default:
      return { event: cap(e.eventType.replace(/[._]+/g, " ")), status: null, ruleIds: [] };
  }
}

const ACTOR: Record<AuditEntry["actor"], AuditVerifyRow["actor"]> = { agent: "agent", gate: "agent", user: "user", system: "system" };

export function toVerifyRow(e: AuditEntry): AuditVerifyRow {
  const d = describeAudit(e);
  return {
    seq: e.seq,
    at: e.createdAt,
    event: d.event,
    actor: ACTOR[e.actor],
    status: d.status,
    ruleIds: d.ruleIds,
    hash: e.hash,
    ...(d.tx ? { tx: d.tx } : {}),
  };
}

/** `recent` may arrive in any order; rows are returned newest first. */
export function buildAuditVerify(check: ChainCheck, recent: AuditEntry[], now: string): AuditVerifyResponse {
  return {
    chainOk: check.ok,
    checkedAt: now,
    count: check.count,
    firstBreakSeq: check.firstBreakSeq,
    rows: [...recent].sort((a, b) => b.seq - a.seq).map(toVerifyRow),
  };
}
