// Zod mirror of the R1 response types in src/server/api-types.ts. Objects are strict, so a fixture
// with an extra or misspelled field fails. `Equal` checks below fail `tsc` if the mirror and the
// TypeScript types ever drift apart.

import { z } from "zod";
import type * as T from "@/src/server/api-types";
import { ORIGINS } from "@/src/server/db/read/db";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
const origin = z.enum(ORIGINS);

export const Money = z.strictObject({ amount: z.number(), currency: z.string().regex(/^[A-Z]{3}$/) });
export const FxMoney = z.strictObject({
  amount: z.number(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  base: z.strictObject({ amount: z.number(), currency: z.string(), rate: z.number().positive(), rateDate: date }).optional(),
});
export const SourceRef = z.strictObject({ origin, sourceId: z.string().optional(), simulated: z.boolean().optional() });

export const SummaryResponse = z.strictObject({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  baseCurrency: z.string(),
  income: Money,
  spending: Money,
  byCategory: z.array(z.strictObject({ category: z.string(), amount: Money, transactionIds: z.array(z.string()) })),
  recurring: z.strictObject({ bills: Money, subscriptions: Money }),
  upcoming14d: z.array(
    z.strictObject({
      kind: z.enum(["bill", "renewal", "trial_conversion", "prepaid_session"]),
      title: z.string(),
      dueDate: z.string(),
      amount: FxMoney,
      refId: z.string(),
    }),
  ),
  balance: Money,
  balanceAfterObligations: Money,
  insights: z.array(z.strictObject({ key: z.string(), text: z.string(), amount: Money.optional(), refIds: z.array(z.string()) })),
});

export const SubscriptionItem = z.strictObject({
  id: z.string(),
  merchant: z.strictObject({ id: z.string(), name: z.string(), category: z.string() }),
  status: z.enum(["active", "inactive", "cancelled", "trial"]),
  cycleDays: z.number().int().positive(),
  amount: FxMoney,
  nextRenewal: z.string().nullable(),
  trial: z.strictObject({ endsAt: z.string(), autoCancelAt: z.string().nullable(), keepFlag: z.boolean(), origin }).nullable(),
  priceChange: z.strictObject({ from: Money, to: Money, at: z.string() }).nullable(),
  usage: z.strictObject({ lastUsedAt: z.string().nullable(), sessionsPerMonth: z.number().nullable(), source: SourceRef }).nullable(),
  annualCost: Money,
  confidence: z.number().min(0).max(1),
  detectionSource: z.enum(["mock_bank", "manual", "email", "csv"]),
});
export const SubscriptionsResponse = z.strictObject({ baseCurrency: z.string(), items: z.array(SubscriptionItem) });

export const RecommendationSignal = z.strictObject({
  key: z.enum(["duplicate", "price_increase", "trial_converted", "low_usage", "fx_cost_high", "high_share"]),
  points: z.number(),
  detail: z.string(),
  source: SourceRef,
});
export const RecommendationItem = z.strictObject({
  id: z.string(),
  subscriptionId: z.string(),
  score: z.number(),
  signals: z.array(RecommendationSignal).min(1), // FR5.10 AC: at least one cited signal
  annualSavings: Money,
  status: z.enum(["open", "accepted", "dismissed"]),
  explanation: z.string().optional(),
});
export const RecommendationsResponse = z.strictObject({ items: z.array(RecommendationItem) });

export const KeepTrialResponse = z.strictObject({ subscriptionId: z.string(), keepFlag: z.literal(true) });

export const ChainTxRef = z.strictObject({ hash: z.string(), explorerUrl: z.string(), simulated: z.boolean() });
export const PrepaidSignal = z.strictObject({
  tier: z.enum(["hard", "soft"]),
  kind: z.enum(["court_enforcement", "closure_notice", "complaints", "news"]),
  level: z.enum(["none", "watch", "elevated"]).optional(),
  summary: z.string(),
  observedAt: z.string(),
  source: SourceRef,
});
const riskLevel = z.enum(["none", "watch", "elevated"]);
export const PrepaidPlanItem = z.strictObject({
  id: z.string(),
  chainPlanId: z.string(),
  merchant: z.strictObject({ id: z.string(), name: z.string(), riskLevel }),
  unitPrice: Money,
  unitsTotal: z.number().int(),
  unitsRedeemed: z.number().int(),
  balanceInEscrow: Money,
  cancelFeeBps: z.number().int(),
  status: z.enum(["active", "completed", "exited_attested", "exited_voluntary"]),
  purchaseTx: ChainTxRef,
  sessions: z.array(z.strictObject({ sessionNo: z.number().int(), redeemedAt: z.string(), tx: ChainTxRef })),
  signals: z.array(PrepaidSignal),
  testTokenNotice: z.string(),
});
export const PrepaidPlansResponse = z.strictObject({ baseCurrency: z.string(), plans: z.array(PrepaidPlanItem) });

export const PrepaidOfferItem = z.strictObject({
  id: z.string(),
  merchant: z.strictObject({ id: z.string(), name: z.string(), escrowSupported: z.boolean(), riskLevel }),
  unitPrice: Money,
  units: z.number().int(),
  total: Money,
  payPerVisitPrice: Money,
  cancelFeeBps: z.number().int(),
  expiresAt: z.string(),
  signals: z.array(PrepaidSignal),
  simulated: z.literal(true),
});
export const PrepaidOffersResponse = z.strictObject({ offers: z.array(PrepaidOfferItem) });

export const PrepaidAdviceResponse = z.strictObject({
  offerId: z.string(),
  savings: Money,
  breakEvenSessions: z.number().int(),
  expectedSessions: z.number(),
  closureRate: z.strictObject({ value: z.number(), source: z.enum(["default", "input", "elevated_signal"]), note: z.string() }),
  periodClosureProbability: z.number(),
  expectedLossWithoutEscrow: Money,
  expectedLossWithEscrow: Money,
  escrowAvailable: z.boolean(),
  recommendation: z.enum(["pay_per_visit", "prepay_escrow", "prepay_with_risk"]),
  explanation: z.string().optional(),
});

export const isoTimestamp = iso;

// ---- compile-time drift checks -------------------------------------------------------------

// Mutual assignability (the strict identity trick rejects `Money & {...}` vs a flat object).
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<X extends true> = X;

export type Checks = [
  Assert<Equal<z.infer<typeof SummaryResponse>, T.SummaryResponse>>,
  Assert<Equal<z.infer<typeof SubscriptionsResponse>, T.SubscriptionsResponse>>,
  Assert<Equal<z.infer<typeof RecommendationsResponse>, T.RecommendationsResponse>>,
  Assert<Equal<z.infer<typeof KeepTrialResponse>, T.KeepTrialResponse>>,
  Assert<Equal<z.infer<typeof PrepaidPlansResponse>, T.PrepaidPlansResponse>>,
  Assert<Equal<z.infer<typeof PrepaidOffersResponse>, T.PrepaidOffersResponse>>,
  Assert<Equal<z.infer<typeof PrepaidAdviceResponse>, T.PrepaidAdviceResponse>>,
];
