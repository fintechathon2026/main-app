// explain (architecture §6.7, PRD §11.1): template-first feed lines from audit rows. The
// Explainer LLM may rephrase them, but its output must contain exactly the numbers of the
// templates; otherwise the raw templates are used. The Planner's own chat reply is checked the
// same way against the tool results and user messages it saw.

import type { AuditRow } from "../deps";
import type { ModelClient } from "../models/types";
import { EXPLAINER_SYSTEM } from "../prompts/explainer";
import type { GraphStateT, NodeFn } from "./graph-state";
import { getDeps } from "./graph-state";
import { numbersSubsetOf, sameNumbers } from "./numbers";

const ACTION_LABELS: Record<string, string> = {
  pay_bill: "Pay",
  cancel_subscription: "Cancel",
  sweep_to_savings: "Sweep to savings",
  prepaid_purchase: "Prepaid purchase",
  prepaid_redeem: "Prepaid session",
  prepaid_exit: "Exit prepaid plan",
  prepaid_exit_voluntary: "Exit prepaid plan",
};

const DECISION_LABELS: Record<string, string> = {
  allow: "allowed",
  require_confirm: "needs your approval",
  deny: "blocked",
};

export const UNVERIFIED_ANSWER =
  "I could not verify every figure in my answer against your data, so I have left the answer out. Please check the Summary screen.";

/** "{action} {payee} {currency} {amount}: {decision} by §{rule_id} v{version}." (+ " tx {short_hash}") */
export function templateLine(row: AuditRow): string {
  const head = [
    ACTION_LABELS[row.tool] ?? row.tool,
    row.payeeName,
    row.amount !== undefined ? row.currency : undefined,
    row.amount !== undefined ? row.amount.toLocaleString("en-US") : undefined,
  ]
    .filter((p): p is string => typeof p === "string" && p.length > 0)
    .join(" ");
  const decision = DECISION_LABELS[row.decision] ?? row.decision;
  const rules = row.ruleIds.length ? ` by ${row.ruleIds.map((r) => `§${r}`).join(", ")}` : "";
  const tx = row.txHash ? ` tx ${shortHash(row.txHash)}` : "";
  return `${head}: ${decision}${rules} v${row.mandateVersion}.${tx}`;
}

export function shortHash(h: string): string {
  return h.length > 12 ? `${h.slice(0, 10)}…` : h;
}

/**
 * Optional LLM rephrase. Falls back to the templates on any error, on a different line count,
 * on any number that differs from the template, or on a missing tx hash.
 */
export async function rephrase(explainer: ModelClient, lines: string[]): Promise<string[]> {
  try {
    const res = await explainer.chat({
      role: "explainer",
      system: EXPLAINER_SYSTEM,
      messages: [{ role: "user", content: JSON.stringify({ lines }) }],
      maxTokens: 1024,
    });
    const out = res.text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (out.length !== lines.length) return lines;
    for (let i = 0; i < lines.length; i++) {
      if (!sameNumbers(out[i], lines[i])) return lines;
      const tx = lines[i].match(/ tx (\S+)$/);
      if (tx && !out[i].includes(tx[1])) return lines;
    }
    return out;
  } catch {
    return lines;
  }
}

/** The Planner's final reply, if it only states numbers it saw in tool results or user turns. */
export function checkedPlannerAnswer(state: GraphStateT): string | null {
  const last = [...state.messages].reverse().find((m) => m.role === "assistant");
  if (!last || last.role !== "assistant" || last.toolCalls?.length || !last.content.trim()) return null;
  const sources = state.messages.flatMap((m) => (m.role === "tool" || m.role === "user" ? [m.content] : []));
  sources.push(JSON.stringify(state.extracted), JSON.stringify(state.warnings));
  return numbersSubsetOf(last.content, sources) ? last.content : UNVERIFIED_ANSWER;
}

export const explain: NodeFn = async (state, config) => {
  const { store, models } = getDeps(config);
  const feed: string[] = [];
  const answer = checkedPlannerAnswer(state);
  if (answer) feed.push(answer);

  const rows = await store.auditRowsForPlan(state.planId, state.userId);
  if (rows.length) {
    const lines = rows.map(templateLine);
    feed.push(...(await rephrase(models.explainer, lines)));
  }
  return { feed };
};
