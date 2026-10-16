// fixtures/api/*.json must (1) parse against the zod mirror of src/server/api-types.ts and
// (2) equal what the real view builders produce for Lin's seed, so R4's screens show numbers the
// code actually computes. Regenerate with: UPDATE_FIXTURES=1 pnpm vitest run tests/read/fixtures.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  buildAdvice,
  buildPrepaidOffers,
  buildPrepaidPlans,
  buildRecommendations,
  buildSubscriptions,
  buildSummary,
} from "@/src/server/db/read/views";
import * as S from "./api-schemas";
import { LIN, NOW, OFFER, SUB, linRecommendationRows, linRepos } from "./lin-seed";

const DIR = join(process.cwd(), "fixtures", "api");

async function generate(): Promise<Record<string, unknown>> {
  const d = { repos: linRepos(await linRecommendationRows()), userId: LIN, now: NOW };
  return {
    "summary.json": await buildSummary(d, "2026-10"),
    "subscriptions.json": await buildSubscriptions(d),
    "recommendations.json": await buildRecommendations(d),
    "subscriptions-keep.json": { subscriptionId: SUB.tencent, keepFlag: true },
    "prepaid-plans.json": await buildPrepaidPlans(d),
    "prepaid-offers.json": await buildPrepaidOffers(d),
    "prepaid-offer-advice.json": (await buildAdvice(d, OFFER.fitbox))!.advice,
  };
}

const SCHEMAS: Record<string, z.ZodType> = {
  "summary.json": S.SummaryResponse,
  "subscriptions.json": S.SubscriptionsResponse,
  "recommendations.json": S.RecommendationsResponse,
  "subscriptions-keep.json": S.KeepTrialResponse,
  "prepaid-plans.json": S.PrepaidPlansResponse,
  "prepaid-offers.json": S.PrepaidOffersResponse,
  "prepaid-offer-advice.json": S.PrepaidAdviceResponse,
};

const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf8")) as unknown;

describe("fixtures/api", () => {
  it("are generated from the view builders", async () => {
    const gen = await generate();
    if (process.env.UPDATE_FIXTURES === "1") {
      for (const [f, v] of Object.entries(gen)) writeFileSync(join(DIR, f), `${JSON.stringify(v, null, 2)}\n`);
    }
    for (const [f, v] of Object.entries(gen)) expect(read(f), f).toEqual(JSON.parse(JSON.stringify(v)));
  });

  for (const [file, schema] of Object.entries(SCHEMAS)) {
    it(`${file} matches its api-types schema`, () => {
      const r = schema.safeParse(read(file));
      expect(r.success, r.success ? "" : `${file}: ${r.error.message}`).toBe(true);
    });
  }

  it("carry Lin's key figures", () => {
    const advice = read("prepaid-offer-advice.json") as z.infer<typeof S.PrepaidAdviceResponse>;
    expect([advice.savings.amount, advice.breakEvenSessions, advice.expectedLossWithoutEscrow.amount]).toEqual([1500, 48, 300]);
    const plans = read("prepaid-plans.json") as z.infer<typeof S.PrepaidPlansResponse>;
    expect(plans.plans[0]).toMatchObject({ unitsTotal: 60, unitsRedeemed: 12, balanceInEscrow: { amount: 4800 }, cancelFeeBps: 1000 });
    expect(plans.plans[0].signals.filter((s) => s.tier === "soft" && s.level === "watch" && s.source.simulated)).toHaveLength(1);
    const subs = read("subscriptions.json") as z.infer<typeof S.SubscriptionsResponse>;
    const gpt = subs.items.find((i) => i.merchant.name === "ChatGPT Plus")!;
    expect(gpt.amount).toMatchObject({ amount: 20, currency: "USD", base: { currency: "CNY", rateDate: "2026-10-16" } });
    expect(subs.items.some((i) => i.status === "trial" && i.trial)).toBe(true);
  });
});
