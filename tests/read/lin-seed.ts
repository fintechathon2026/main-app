// Lin's synthetic demo data (PRD §4.3) as in-memory read repositories. Used to test the view
// builders and read tools, and to generate fixtures/api/*.json from the real code paths
// (UPDATE_FIXTURES=1 pnpm vitest run tests/read/fixtures.test.ts). All values are synthetic.

import type { AccountRow } from "@/src/server/db/read/accounts";
import type { BillRow } from "@/src/server/db/read/bills";
import type { FxRateRow } from "@/src/server/db/read/fx";
import type { PrepaidOfferRow, PrepaidPlanRow, PrepaidSessionRow } from "@/src/server/db/read/prepaid";
import type { RecommendationRow } from "@/src/server/db/read/recommendations";
import type { ReadRepos } from "@/src/server/db/read/repos";
import type { AttestationRow, RiskSignalRow } from "@/src/server/db/read/risk";
import type { UserSettings } from "@/src/server/db/read/settings";
import type { SubscriptionRow, UsageSignalRow } from "@/src/server/db/read/subscriptions";
import type { TransactionRow } from "@/src/server/db/read/transactions";
import { scoreRecommendations } from "@/src/server/db/read/views";

export const LIN = "8b3c6f1e-2a4d-4c5e-9f70-1a2b3c4d5e6f";
export const OTHER_USER = "00000000-0000-4000-8000-0000000000ff";
export const NOW = "2026-10-17T09:00:00.000Z";

const uid = (group: number, n: number) => `${String(group).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const hash = (n: number) => `0x${"5e1f7a2c".repeat(7).slice(0, 56)}${n.toString(16).padStart(8, "0")}`;

export const SUB = {
  gpt: uid(2, 1),
  iqiyi: uid(2, 2),
  netease: uid(2, 3),
  tencent: uid(2, 4),
};
export const PLAN_ID = uid(4, 1);
export const OFFER = { fitbox: uid(5, 1), ironpeak: uid(5, 2) };

const M = {
  gpt: { id: uid(1, 1), name: "ChatGPT Plus", category: "software" },
  iqiyi: { id: uid(1, 2), name: "iQIYI", category: "video" },
  netease: { id: uid(1, 3), name: "NetEase Cloud Music", category: "music" },
  tencent: { id: uid(1, 4), name: "Tencent Video", category: "video" },
  rent: { id: uid(1, 5), name: "Futian Apartments", category: "housing" },
  power: { id: uid(1, 6), name: "Shenzhen Power", category: "utilities" },
  mobile: { id: uid(1, 7), name: "China Mobile", category: "telecom" },
  meituan: { id: uid(1, 8), name: "Meituan", category: "food" },
  metro: { id: uid(1, 9), name: "Shenzhen Metro", category: "transport" },
  taobao: { id: uid(1, 10), name: "Taobao", category: "shopping" },
  payroll: { id: uid(1, 11), name: "Payroll", category: "income" },
};

let txN = 0;
function tx(date: string, amount: number, m: { id: string; name: string; category: string }, extra: Partial<TransactionRow> = {}): TransactionRow {
  txN++;
  const n = String(txN).padStart(4, "0");
  return {
    id: uid(3, txN),
    account_id: uid(9, 1),
    posted_at: `${date}T00:00:00.000Z`,
    amount,
    currency: "CNY",
    raw_descriptor: m.name.toUpperCase(),
    original_amount: null,
    original_currency: null,
    fx_rate: null,
    fx_rate_date: null,
    merchant_id: m.id,
    merchant_name: m.name,
    category: m.category,
    source_id: `mock:tx-${n}`,
    origin: "mock_bank",
    ...extra,
  };
}

// USD→CNY reference rates on ChatGPT posting dates (synthetic, ±1% wobble).
export const USD_CNY: Record<string, number> = {
  "2026-06-24": 7.16,
  "2026-07-24": 7.13,
  "2026-08-24": 7.2,
  "2026-09-24": 7.14,
  "2026-10-16": 7.12,
};

const gpt = (date: string) =>
  tx(date, -Math.round(20 * USD_CNY[date] * 100) / 100, M.gpt, {
    original_amount: -20,
    original_currency: "USD",
    fx_rate: USD_CNY[date],
    fx_rate_date: date,
  });

export const transactions: TransactionRow[] = [
  // Subscriptions
  gpt("2026-06-24"),
  gpt("2026-07-24"),
  gpt("2026-08-24"),
  gpt("2026-09-24"),
  tx("2026-06-05", -25, M.iqiyi),
  tx("2026-07-05", -25, M.iqiyi),
  tx("2026-08-05", -25, M.iqiyi),
  tx("2026-09-05", -30, M.iqiyi),
  tx("2026-10-05", -30, M.iqiyi),
  tx("2026-06-29", -15, M.netease),
  tx("2026-07-29", -15, M.netease),
  tx("2026-08-29", -15, M.netease),
  tx("2026-09-29", -15, M.netease),
  // Bills paid
  tx("2026-08-28", -3500, M.rent),
  tx("2026-09-28", -3500, M.rent),
  tx("2026-09-03", -168, M.power),
  tx("2026-10-02", -174, M.power),
  tx("2026-09-20", -88, M.mobile),
  // Everyday spending
  tx("2026-09-05", -230, M.meituan),
  tx("2026-09-18", -310, M.meituan),
  tx("2026-10-03", -86, M.meituan),
  tx("2026-10-08", -152, M.meituan),
  tx("2026-10-12", -64, M.meituan),
  tx("2026-10-15", -118, M.meituan),
  tx("2026-10-06", -60, M.metro),
  tx("2026-10-13", -40, M.metro),
  tx("2026-10-11", -268, M.taobao),
  // Income
  tx("2026-09-10", 12000, M.payroll),
  tx("2026-10-10", 12000, M.payroll),
];

const subBase = {
  next_renewal: null,
  billing_currency: null,
  original_amount: null,
  trial_end: null,
  trial_status_origin: null,
  keep_flag: false,
  detection_source: "mock_bank",
  cycle_days: 30,
  currency: "CNY",
} as const;

export const subscriptions: SubscriptionRow[] = [
  {
    ...subBase,
    id: SUB.gpt,
    merchant_id: M.gpt.id,
    merchant_name: M.gpt.name,
    category: M.gpt.category,
    amount: 142.8,
    next_renewal: "2026-10-24",
    billing_currency: "USD",
    original_amount: 20,
    status: "active",
    first_seen: "2026-06-24",
    last_charged: "2026-09-24",
    confidence: 0.9,
  },
  {
    ...subBase,
    id: SUB.iqiyi,
    merchant_id: M.iqiyi.id,
    merchant_name: M.iqiyi.name,
    category: M.iqiyi.category,
    amount: 30,
    next_renewal: "2026-11-05",
    status: "active",
    first_seen: "2026-06-05",
    last_charged: "2026-10-05",
    confidence: 0.95,
  },
  {
    ...subBase,
    id: SUB.netease,
    merchant_id: M.netease.id,
    merchant_name: M.netease.name,
    category: M.netease.category,
    amount: 15,
    next_renewal: "2026-10-29",
    status: "active",
    first_seen: "2026-06-29",
    last_charged: "2026-09-29",
    confidence: 0.9,
  },
  {
    ...subBase,
    id: SUB.tencent,
    merchant_id: M.tencent.id,
    merchant_name: M.tencent.name,
    category: M.tencent.category,
    amount: 30,
    status: "trial",
    first_seen: "2026-09-21",
    last_charged: null,
    confidence: 1,
    trial_end: "2026-10-21T00:00:00.000Z",
    trial_status_origin: "mock_bank",
  },
];

export const usageSignals: UsageSignalRow[] = [
  {
    subscription_id: SUB.netease,
    merchant_id: M.netease.id,
    source: "sim:netease-usage-2026-10",
    metric: "sessions",
    value: 1,
    period_start: "2026-09-17",
    period_end: "2026-10-16",
    origin: "simulated",
    simulated: true,
  },
  {
    subscription_id: SUB.netease,
    merchant_id: M.netease.id,
    source: "sim:netease-usage-2026-10",
    metric: "last_used",
    value: null,
    period_start: null,
    period_end: "2026-10-02",
    origin: "simulated",
    simulated: true,
  },
];

export const bills: BillRow[] = [
  { id: uid(6, 1), biller_id: "SZ_POWER", biller_name: "Shenzhen Power", amount: 174, due_date: "2026-10-02", period: "2026-09", document_id: null, status: "paid", created_at: null },
  { id: uid(6, 2), biller_id: "CHINA_MOBILE", biller_name: "China Mobile", amount: 88, due_date: "2026-10-20", period: "2026-10", document_id: null, status: "pending", created_at: null },
  { id: uid(6, 3), biller_id: "SZ_POWER", biller_name: "Shenzhen Power", amount: 186, due_date: "2026-10-22", period: "2026-10", document_id: uid(7, 1), status: "pending", created_at: null },
  { id: uid(6, 4), biller_id: "RENT_FUTIAN", biller_name: "Futian Apartments", amount: 3500, due_date: "2026-10-28", period: "2026-11", document_id: null, status: "pending", created_at: null },
];

export const accounts: AccountRow[] = [
  { id: uid(9, 1), provider: "mockbank", type: "checking", currency: "CNY", balance: 9850, updated_at: NOW },
];

export const settings: UserSettings = {
  baseCurrency: "CNY",
  mandateVersion: 1,
  autoCancelTrials: { enabled: true, daysBeforeCharge: 1 },
  anomaly: { k: 3.5, minHistory: 3 },
  renewalNoticeDays: 5,
};

export const fxRates: FxRateRow[] = Object.entries(USD_CNY).map(([date, rate]) => ({
  date,
  base: "USD",
  quote: "CNY",
  rate,
  source: "fx_provider",
  fetched_at: null,
}));

export const prepaidPlans: PrepaidPlanRow[] = [
  {
    id: PLAN_ID,
    chain_plan_id: "1",
    merchant_id: "FITBOX_FUTIAN",
    merchant_name: "FitBox Futian",
    merchant_risk_level: "none",
    unit_price: 10000,
    units_total: 60,
    units_redeemed: 12,
    cancel_fee_bps: 1000,
    agent_address: "0x4a6e00000000000000000000000000000000a9e7",
    status: "active",
    purchase_tx: hash(1),
    origin: "chain",
  },
];

const sessionDates = ["2026-08-01", "2026-08-05", "2026-08-09", "2026-08-15", "2026-08-22", "2026-08-29", "2026-09-05", "2026-09-12", "2026-09-19", "2026-09-26", "2026-10-03", "2026-10-10"];
export const prepaidSessions: PrepaidSessionRow[] = sessionDates.map((d, i) => ({
  plan_id: PLAN_ID,
  session_no: i + 1,
  tx_hash: hash(100 + i + 1),
  redeemed_at: `${d}T11:30:00.000Z`,
}));

export const offers: PrepaidOfferRow[] = [
  {
    id: OFFER.fitbox,
    merchant_id: "FITBOX_FUTIAN",
    merchant_name: "FitBox Futian",
    escrow_supported: true,
    merchant_risk_level: "none",
    unit_price: 10000,
    units: 60,
    cancel_fee_bps: 1000,
    expires_at: "2026-10-31T15:59:59.000Z",
    offer_json: { merchantName: "FitBox Futian", payPerVisitPrice: 12500, currency: "CNY" },
  },
  {
    id: OFFER.ironpeak,
    merchant_id: "IRONPEAK_NANSHAN",
    merchant_name: "IronPeak Nanshan",
    escrow_supported: false,
    merchant_risk_level: "none",
    unit_price: 9000,
    units: 40,
    cancel_fee_bps: 2000,
    expires_at: "2026-10-31T15:59:59.000Z",
    offer_json: { merchantName: "IronPeak Nanshan", payPerVisitPrice: 11000, currency: "CNY" },
  },
];

export const attestations: AttestationRow[] = [];

export const riskSignals: RiskSignalRow[] = [
  {
    id: uid(8, 1),
    merchant_id: "FITBOX_FUTIAN",
    kind: "complaints",
    level: "watch",
    summary: "Complaints about FitBox Futian rose from 2 to 7 this week (simulated feed).",
    source_ids: ["sim:complaints-fitbox-2026-w42"],
    origin: "simulated",
    simulated: true,
    observed_at: "2026-10-15T02:00:00.000Z",
  },
];

/** Fake repos over the seed; rows exist only for LIN. `recommendations` is injectable. */
export function linRepos(recs: RecommendationRow[] = [], over: Partial<ReadRepos> = {}): ReadRepos & { keepCalls: string[] } {
  const mine = <T>(u: string, rows: T[]) => (u === LIN ? rows : []);
  const keepCalls: string[] = [];
  const subs = subscriptions.map((s) => ({ ...s }));
  return {
    keepCalls,
    accounts: async (u) => mine(u, accounts),
    transactions: async (u, f) =>
      mine(u, transactions).filter(
        (t) =>
          t.posted_at.slice(0, 10) >= f.from &&
          t.posted_at.slice(0, 10) <= f.to &&
          (!f.merchant || t.merchant_id === f.merchant || (t.merchant_name ?? "").toLowerCase().includes(f.merchant.toLowerCase())),
      ),
    bills: async (u, s) => mine(u, bills).filter((b) => !s || b.status === s),
    subscriptions: async (u, s) => mine(u, subs).filter((x) => !s || x.status === s),
    subscription: async (u, id) => mine(u, subs).find((x) => x.id === id) ?? null,
    usageSignals: async (u) => mine(u, usageSignals),
    recommendations: async (u) => mine(u, recs),
    settings: async () => settings,
    fxRate: async (_u, b, q, d) =>
      fxRates.filter((r) => r.base === b && r.quote === q && r.date <= d).sort((x, y) => y.date.localeCompare(x.date))[0] ?? null,
    fxRates: async (_u, b, q, from, to) => fxRates.filter((r) => r.base === b && r.quote === q && r.date <= to && r.date >= from),
    prepaidPlans: async (u) => mine(u, prepaidPlans),
    prepaidSessions: async (u) => mine(u, prepaidSessions),
    prepaidOffers: async (_u, now) => offers.filter((o) => o.expires_at > now),
    prepaidOffer: async (_u, id) => offers.find((o) => o.id === id) ?? null,
    attestations: async (_u, ids) => attestations.filter((a) => ids.includes(a.merchant_id)),
    riskSignals: async (_u, ids) => riskSignals.filter((r) => ids.includes(r.merchant_id)),
    keepTrial: async (u, id) => {
      keepCalls.push(id);
      const s = mine(u, subs).find((x) => x.id === id);
      if (!s) return "not_found";
      if (s.status !== "trial") return "not_trial";
      s.keep_flag = true;
      return "ok";
    },
    ...over,
  };
}

/** Recommendation rows as cron/detect would store them for Lin. */
export async function linRecommendationRows(): Promise<RecommendationRow[]> {
  const { ranked } = await scoreRecommendations({ repos: linRepos(), userId: LIN, now: NOW });
  return ranked.map((r, i) => ({
    id: `00000010-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    subscription_id: r.subscriptionId,
    score: r.score,
    signals_json: r.signals,
    status: "open",
    created_at: NOW,
  }));
}

