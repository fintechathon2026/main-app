// list_subscriptions, compute_savings, get_financial_summary, get_fx_rate, list_recommendations.
// Every number comes from src/core via the shared view builders (G6).

import { z } from "zod";
import type { Labeled } from "@/src/core/types";
import { SUBSCRIPTION_STATUSES } from "@/src/server/db/read/subscriptions";
import {
  DETECTION_ORIGIN,
  buildRecommendations,
  buildSavings,
  buildSummary,
  loadSubscriptionContext,
  rateLookupFor,
} from "@/src/server/db/read/views";
import { defineReadTool, zCurrency, zDate, zId } from "./define";

export const listSubscriptions = defineReadTool({
  name: "list_subscriptions",
  description:
    "Subscriptions with amount (foreign amounts include the base-currency equivalent and rate date), renewal date, trial info, detected price changes, usage (null means no usage data: do not call it unused) and annual cost.",
  args: z.object({ status: z.enum(SUBSCRIPTION_STATUSES).optional() }).strict(),
  async run(a, d): Promise<Labeled<unknown>[]> {
    const ctx = await loadSubscriptionContext(d, a.status ?? null);
    return ctx.subs.map((s) => ({ origin: DETECTION_ORIGIN[s.row.detection_source], sourceId: s.row.id, value: s.item }));
  },
});

export const computeSavingsTool = defineReadTool({
  name: "compute_savings",
  description: "Annual amount saved by cancelling one subscription, in the base currency (converted at the stored reference rate for foreign plans).",
  args: z.object({ subscription_id: zId }).strict(),
  async run(a, d): Promise<Labeled<unknown> | { error: string }> {
    const s = await buildSavings(d, a.subscription_id);
    if (!s) return { error: "subscription_not_found" };
    const { origin, ...value } = s;
    return { origin, sourceId: a.subscription_id, value };
  },
});

export const getFinancialSummary = defineReadTool({
  name: "get_financial_summary",
  description:
    "Monthly summary for a period (YYYY-MM): income, spending by category, recurring obligations, the next 14 days of bills/renewals/trial conversions, balance after obligations, and insights.",
  args: z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "YYYY-MM") }).strict(),
  async run(a, d): Promise<Labeled<unknown>> {
    return { origin: "mock_bank", sourceId: `summary:${a.period}`, value: await buildSummary(d, a.period) };
  },
});

export const getFxRate = defineReadTool({
  name: "get_fx_rate",
  description:
    "ECB reference rate (Frankfurter) for base→quote on or before a date. `stale: true` means the rate is more than 2 days old.",
  args: z.object({ base: zCurrency, quote: zCurrency, date: zDate }).strict(),
  async run(a, d): Promise<Labeled<unknown> | { error: string }> {
    const r = await rateLookupFor(d)(a.base, a.quote, a.date);
    if (!r) return { error: "rate_unavailable" };
    return { origin: "fx_provider", sourceId: `frankfurter:${r.base}${r.quote}:${r.rateDate}`, value: r };
  },
});

export const listRecommendationsTool = defineReadTool({
  name: "list_recommendations",
  description:
    "Ranked cancel recommendations. Each lists the signals that fired, their points and sources, and the annual savings. Explain only these signals; never add a score.",
  args: z.object({}).strict(),
  async run(_a, d): Promise<Labeled<unknown>[]> {
    const r = await buildRecommendations(d);
    return r.items.map((i) => ({ origin: "mock_bank", sourceId: i.id, value: i }));
  },
});
