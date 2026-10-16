// Turns recurring-charge detections into subscription upserts (FR5.1, FR5.4) for cron/detect.
// Pure: the caller loads charges and existing rows and applies the plan.
// Rules: a merchant with a detected recurring charge and no subscription row gets a new
// `mock_bank`-sourced row; an existing `mock_bank` row that is active or inactive gets its status,
// last charge, next renewal and confidence refreshed. Trials, cancelled rows and manual/email/csv
// rows are never touched here.

import { round2 } from "./stats";
import { type ChargeTx, type RateLookup, type RecurringResult, detectRecurring, recurringStatus } from "./recurring";

export type ExistingSub = {
  id: string;
  merchantId: string;
  status: "active" | "inactive" | "cancelled" | "trial";
  detectionSource: "mock_bank" | "manual" | "email" | "csv";
  billingCurrency: string | null;
};

export type SubInsert = {
  merchantId: string;
  cycleDays: number;
  amount: number; // base currency, latest charge
  currency: string; // base
  billingCurrency: string;
  originalAmount: number;
  nextRenewal: string;
  status: "active" | "inactive";
  firstSeen: string;
  lastCharged: string;
  confidence: number;
  sourceId: string;
};

export type SubUpdate = {
  id: string;
  status: "active" | "inactive";
  lastCharged: string;
  nextRenewal: string;
  confidence: number;
};

export type DetectPlan = { inserts: SubInsert[]; updates: SubUpdate[]; detections: Map<string, RecurringResult> };

export function planSubscriptionUpserts(input: {
  charges: ReadonlyMap<string, readonly ChargeTx[]>;
  existing: readonly ExistingSub[];
  baseCurrency: string;
  now: string;
  rateOn?: RateLookup;
  /** Billing-currency hints per merchant (e.g. from merchant metadata). */
  currencyHints?: ReadonlyMap<string, string>;
}): DetectPlan {
  const inserts: SubInsert[] = [];
  const updates: SubUpdate[] = [];
  const detections = new Map<string, RecurringResult>();
  const byMerchant = new Map(input.existing.map((s) => [s.merchantId, s]));
  const merchants = [...input.charges.keys()].sort();

  for (const merchantId of merchants) {
    const txs = input.charges.get(merchantId) ?? [];
    const sub = byMerchant.get(merchantId);
    const hint = sub?.billingCurrency ?? input.currencyHints?.get(merchantId);
    const det = detectRecurring(txs, {
      baseCurrency: input.baseCurrency,
      candidateCurrencies: hint && hint !== input.baseCurrency ? [hint] : [],
      rateOn: input.rateOn,
    });
    if (!det) continue;
    detections.set(merchantId, det);
    const status = recurringStatus(det.lastCharged, det.cycleDays, input.now);
    const last = [...txs].sort((a, b) => a.date.localeCompare(b.date)).pop() as ChargeTx;

    if (!sub) {
      inserts.push({
        merchantId,
        cycleDays: det.cycleDays,
        amount: round2(last.amount),
        currency: input.baseCurrency,
        billingCurrency: det.currency,
        originalAmount: det.amount,
        nextRenewal: det.nextExpected,
        status,
        firstSeen: det.firstSeen,
        lastCharged: det.lastCharged,
        confidence: det.confidence,
        sourceId: `detect:${merchantId}`,
      });
    } else if (sub.detectionSource === "mock_bank" && (sub.status === "active" || sub.status === "inactive")) {
      updates.push({ id: sub.id, status, lastCharged: det.lastCharged, nextRenewal: det.nextExpected, confidence: det.confidence });
    }
  }
  return { inserts, updates, detections };
}
