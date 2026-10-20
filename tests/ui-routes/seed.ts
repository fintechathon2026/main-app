// Owner: R2 (roles.md). Lin's decided actions as stored rows, the input of the feed view builder.
// Gate traces follow src/core/gate/decide.ts (rule ids, result, reason keys).

import { hashPolicy } from "@/src/core/mandate/canonical";
import { LIN_MANDATE_V3 } from "@/src/core/mandate/examples";
import type { FeedActionRow } from "@/src/server/db/read/feed-view";
import type { MandateRow } from "@/src/server/db/read/mandate-view";

export const TX = "0x5e1f7a2c5e1f7a2c5e1f7a2c5e1f7a2c5e1f7a2c5e1f7a2c5e1f7a2c00000070";
export const MANDATE_HASH = "9f3a1c0d7b5e4a2c8d6f1b3e5a7c9d0e2f4a6b8c0d1e3f5a7b9c1d2e4f6a8b0c";

type Step = { ruleId: string; result: "allow" | "require_confirm" | "deny"; reason?: string };
const ok = (ruleId: string): Step => ({ ruleId, result: "allow" });
const gate = (decision: Step["result"], trace: Step[], ruleIds: string[]) => ({
  decision,
  ruleIds,
  reasons: [],
  mandateVersion: 3,
  mandateHash: MANDATE_HASH,
  amountBase: 0,
  trace,
});

const BASE = {
  mandateVersion: 3,
  baseCurrency: "CNY",
  result: null,
  bill: null,
  subscription: null,
  prepaid: null,
} satisfies Partial<FeedActionRow>;

const billPrefix: Step[] = [ok("global.kill_switch"), ok("schema.pay_bill"), ok("mandate.valid"), ok("provenance.destination"), ok("provenance.amount_mismatch"), ok("provenance.amount")];

export const LIN_FEED_ROWS: FeedActionRow[] = [
  {
    ...BASE,
    id: "ac000000-0000-4000-8000-000000000002",
    tool: "pay_bill",
    status: "awaiting_approval",
    decision: "require_confirm",
    ruleIds: ["bills.auto_pay_max"],
    args: { bill_id: "b1000000-0000-4000-8000-000000000004", biller_id: "LANDLORD_WANG", amount: 3500 },
    at: "2026-10-19T01:12:00.000Z",
    bill: { billerName: "Landlord Wang", currency: "CNY", dueDate: "2026-10-28", amountOrigin: "mock_bank" },
    gate: gate(
      "require_confirm",
      [...billPrefix, ok("payees.allow"), { ruleId: "bills.auto_pay_max", result: "require_confirm", reason: "bills.over_auto_pay_max" }, ok("global.daily_outflow_cap")],
      ["bills.auto_pay_max"],
    ),
  },
  {
    ...BASE,
    id: "ac000000-0000-4000-8000-000000000001",
    tool: "cancel_subscription",
    status: "awaiting_approval",
    decision: "require_confirm",
    ruleIds: ["subscriptions.cancel"],
    args: { subscription_id: "5b000000-0000-4000-8000-000000000002" },
    at: "2026-10-19T02:40:00.000Z",
    subscription: { merchantName: "iQIYI", amount: 30, currency: "CNY" },
    gate: gate(
      "require_confirm",
      [ok("global.kill_switch"), ok("schema.cancel_subscription"), ok("mandate.valid"), ok("provenance.subscription"), { ruleId: "subscriptions.cancel", result: "require_confirm", reason: "subscriptions.cancel_needs_confirm" }],
      ["subscriptions.cancel"],
    ),
  },
  {
    ...BASE,
    id: "ac000000-0000-4000-8000-000000000003",
    tool: "pay_bill",
    status: "denied",
    decision: "deny",
    ruleIds: ["provenance.destination"],
    args: { bill_id: "b1000000-0000-4000-8000-000000000009", biller_id: "SZ_POWER", amount: 186 },
    at: "2026-10-18T09:05:00.000Z",
    bill: { billerName: null, currency: "CNY", dueDate: "2026-10-30", amountOrigin: "email" },
    gate: gate(
      "deny",
      [ok("global.kill_switch"), ok("schema.pay_bill"), ok("mandate.valid"), { ruleId: "provenance.destination", result: "deny", reason: "provenance.destination_not_registry" }],
      ["provenance.destination"],
    ),
  },
  {
    ...BASE,
    id: "ac000000-0000-4000-8000-000000000004",
    tool: "pay_bill",
    status: "succeeded",
    decision: "allow",
    ruleIds: [...billPrefix.map((s) => s.ruleId), "payees.allow", "bills.auto_pay_max", "global.daily_outflow_cap"],
    args: { bill_id: "b1000000-0000-4000-8000-000000000001", biller_id: "CHINA_MOBILE", amount: 88 },
    at: "2026-10-18T08:30:02.000Z",
    bill: { billerName: "China Mobile", currency: "CNY", dueDate: "2026-10-20", amountOrigin: "mock_bank" },
    gate: gate(
      "allow",
      [...billPrefix, ok("payees.allow"), ok("bills.auto_pay_max"), ok("global.daily_outflow_cap")],
      [...billPrefix.map((s) => s.ruleId), "payees.allow", "bills.auto_pay_max", "global.daily_outflow_cap"],
    ),
  },
  {
    ...BASE,
    id: "ac000000-0000-4000-8000-000000000006",
    tool: "prepaid_redeem",
    status: "succeeded",
    decision: "allow",
    ruleIds: ["prepaid.redeem"],
    args: { plan_id: "e1000000-0000-4000-8000-000000000001", session_no: 12 },
    at: "2026-10-10T11:30:00.000Z",
    prepaid: { merchantName: "FitBox Futian", unitPriceFen: 10000, unitsTotal: 20, unitsRedeemed: 12 },
    result: { txHash: TX, simulated: false },
    gate: gate("allow", [ok("global.kill_switch"), ok("schema.prepaid_redeem"), ok("mandate.valid"), ok("provenance.prepaid_plan"), ok("prepaid.redeem")], ["prepaid.redeem"]),
  },
];

// ---- Mandates ----------------------------------------------------------------------------

const WITHOUT_PREPAID = Object.fromEntries(Object.entries(LIN_MANDATE_V3).filter(([k]) => k !== "prepaid"));
const V2 = { ...WITHOUT_PREPAID, version: 2 };
const V1 = { ...V2, version: 1, bills: { ...LIN_MANDATE_V3.bills, auto_pay_max: 500 } };

const mandate = (version: number, policy: unknown, signedAt: string, status: MandateRow["status"]): MandateRow => ({
  version,
  policyJson: policy,
  policyHash: hashPolicy(policy),
  signedAt,
  status,
  createdVia: version === 1 ? "template" : "nl",
});

/** Lin's three signed versions (the first two are superseded). */
export const LIN_MANDATE_ROWS: MandateRow[] = [
  mandate(1, V1, "2026-10-01T09:15:00.000Z", "superseded"),
  mandate(2, V2, "2026-10-05T10:02:00.000Z", "superseded"),
  mandate(3, LIN_MANDATE_V3, "2026-10-12T06:20:00.000Z", "active"),
];
