// The read-repository port used by read tools, UI routes and the detect job. The pg
// implementation runs every call in `withUserTx`, so RLS scopes rows to `userId` (architecture
// §12.3); queries also filter by user explicitly. Tests inject fakes.

import { withUserTx } from "../pool";
import { type AccountRow, getAccounts } from "./accounts";
import { type BillRow, listBills } from "./bills";
import { type FxRateRow, getFxRateRow, listFxRates } from "./fx";
import {
  type PrepaidOfferRow,
  type PrepaidPlanRow,
  type PrepaidSessionRow,
  getPrepaidOffer,
  listPrepaidOffers,
  listPrepaidPlans,
  listPrepaidSessions,
} from "./prepaid";
import { type RecommendationRow, listRecommendations } from "./recommendations";
import { type AttestationRow, type RiskSignalRow, listAttestations, listRiskSignals } from "./risk";
import { type UserSettings, getUserSettings } from "./settings";
import {
  type SubscriptionRow,
  type UsageSignalRow,
  getSubscription,
  listSubscriptions,
  listUsageSignals,
  setTrialKeepFlag,
} from "./subscriptions";
import { type TransactionRow, listTransactions } from "./transactions";

export interface ReadRepos {
  accounts(userId: string): Promise<AccountRow[]>;
  transactions(userId: string, f: { from: string; to: string; merchant?: string | null }): Promise<TransactionRow[]>;
  bills(userId: string, status?: string | null): Promise<BillRow[]>;
  subscriptions(userId: string, status?: string | null): Promise<SubscriptionRow[]>;
  subscription(userId: string, id: string): Promise<SubscriptionRow | null>;
  usageSignals(userId: string): Promise<UsageSignalRow[]>;
  recommendations(userId: string): Promise<RecommendationRow[]>;
  settings(userId: string): Promise<UserSettings>;
  fxRate(userId: string, base: string, quote: string, date: string): Promise<FxRateRow | null>;
  fxRates(userId: string, base: string, quote: string, from: string, to: string): Promise<FxRateRow[]>;
  prepaidPlans(userId: string): Promise<PrepaidPlanRow[]>;
  prepaidSessions(userId: string): Promise<PrepaidSessionRow[]>;
  prepaidOffers(userId: string, now: string): Promise<PrepaidOfferRow[]>;
  prepaidOffer(userId: string, id: string): Promise<PrepaidOfferRow | null>;
  attestations(userId: string, merchantIds: string[]): Promise<AttestationRow[]>;
  riskSignals(userId: string, merchantIds: string[]): Promise<RiskSignalRow[]>;
  /** User-initiated "keep it" on a trial; the only write behind this port. */
  keepTrial(userId: string, subscriptionId: string): Promise<"ok" | "not_found" | "not_trial">;
}

export function createPgReadRepos(tx: typeof withUserTx = withUserTx): ReadRepos {
  return {
    accounts: (u) => tx(u, (q) => getAccounts(q, u)),
    transactions: (u, f) => tx(u, (q) => listTransactions(q, u, f)),
    bills: (u, s) => tx(u, (q) => listBills(q, u, s)),
    subscriptions: (u, s) => tx(u, (q) => listSubscriptions(q, u, s)),
    subscription: (u, id) => tx(u, (q) => getSubscription(q, u, id)),
    usageSignals: (u) => tx(u, (q) => listUsageSignals(q, u)),
    recommendations: (u) => tx(u, (q) => listRecommendations(q, u)),
    settings: (u) => tx(u, (q) => getUserSettings(q, u)),
    fxRate: (u, b, qt, d) => tx(u, (q) => getFxRateRow(q, b, qt, d)),
    fxRates: (u, b, qt, f, t) => tx(u, (q) => listFxRates(q, b, qt, f, t)),
    prepaidPlans: (u) => tx(u, (q) => listPrepaidPlans(q, u)),
    prepaidSessions: (u) => tx(u, (q) => listPrepaidSessions(q, u)),
    prepaidOffers: (u, now) => tx(u, (q) => listPrepaidOffers(q, now)),
    prepaidOffer: (u, id) => tx(u, (q) => getPrepaidOffer(q, id)),
    attestations: (u, m) => tx(u, (q) => listAttestations(q, m)),
    riskSignals: (u, m) => tx(u, (q) => listRiskSignals(q, m)),
    keepTrial: (u, id) => tx(u, (q) => setTrialKeepFlag(q, u, id)),
  };
}

let defaultRepos: ReadRepos | null = null;
/** Lazily created; no connection is opened until a method runs. */
export function getReadRepos(): ReadRepos {
  return (defaultRepos ??= createPgReadRepos());
}
