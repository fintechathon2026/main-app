// Side-effect-free read tools bound to the Planner's ToolNode (architecture §6.4). `propose_action`
// and the action schemas live elsewhere. Built from injected repositories so tests use fakes.

import { getReadRepos } from "@/src/server/db/read/repos";
import type { ReadTool } from "../types";
import { getBalance, listBills, listTransactions } from "./banking";
import type { ToolDeps } from "./define";
import { computeSavingsTool, getFinancialSummary, getFxRate, listRecommendationsTool, listSubscriptions } from "./insights";
import { advisePrepaidTool, listPrepaidPlans, listRiskSignals } from "./prepaid";

const factories = [
  getBalance,
  listTransactions,
  listBills,
  listSubscriptions,
  computeSavingsTool,
  getFinancialSummary,
  getFxRate,
  listRecommendationsTool,
  listPrepaidPlans,
  advisePrepaidTool,
  listRiskSignals,
];

export const READ_TOOL_NAMES = [
  "get_balance",
  "list_transactions",
  "list_bills",
  "list_subscriptions",
  "compute_savings",
  "get_financial_summary",
  "get_fx_rate",
  "list_recommendations",
  "list_prepaid_plans",
  "advise_prepaid",
  "list_risk_signals",
] as const;

export function createReadTools(deps: ToolDeps): ReadTool[] {
  return factories.map((f) => f(deps) as ReadTool);
}

/** Production tools over Postgres. Creating them opens no connection. */
export const readTools: ReadTool[] = createReadTools({ repos: getReadRepos() });
