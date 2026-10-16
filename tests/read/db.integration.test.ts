// Read repositories against the real migrations and supabase/seed.sql (local Supabase), as the
// reins_server role under RLS. Skipped without DATABASE_URL, e.g.
// DATABASE_URL=postgres://reins_server:reins-server-local@127.0.0.1:54322/postgres pnpm test
// Never mutates the seed: writes run in transactions that roll back, or use a 1999 FX date.

import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setPool } from "@/src/server/db/pool";
import { createPgReadRepos } from "@/src/server/db/read/repos";
import {
  buildAdvice,
  buildPrepaidOffers,
  buildPrepaidPlans,
  buildRecommendations,
  buildSubscriptions,
  buildSummary,
} from "@/src/server/db/read/views";
import { getRate, storeFxRates } from "@/src/server/fx/frankfurter";
import * as S from "./api-schemas";

const URL_ = process.env.DATABASE_URL;
const LIN = "11111111-1111-4111-8111-111111111111";
const STRANGER = "22222222-2222-4222-8222-222222222222";

describe.skipIf(!URL_)("read side on the real schema (local Supabase)", () => {
  let pool: Pool;
  beforeAll(() => {
    pool = new Pool({ connectionString: URL_, max: 3 });
    setPool(pool);
  });
  afterAll(async () => {
    setPool(null);
    await pool.end();
  });

  const repos = () => createPgReadRepos();
  const now = () => new Date().toISOString();
  const d = (userId = LIN) => ({ repos: repos(), userId, now: now() });

  it("every repository query parses against the migrations", async () => {
    const r = repos();
    const today = now().slice(0, 10);
    expect((await r.accounts(LIN)).length).toBeGreaterThan(0);
    expect((await r.transactions(LIN, { from: "2025-01-01", to: today })).length).toBeGreaterThan(0);
    expect((await r.bills(LIN, "unpaid")).every((b) => b.status === "unpaid")).toBe(true);
    expect((await r.subscriptions(LIN)).length).toBeGreaterThan(0);
    await r.usageSignals(LIN);
    await r.recommendations(LIN);
    expect((await r.settings(LIN)).baseCurrency).toBe("CNY");
    expect(await r.fxRate(LIN, "USD", "CNY", today)).not.toBeNull();
    await r.fxRates(LIN, "USD", "CNY", "2025-01-01", today);
    expect((await r.prepaidPlans(LIN)).length).toBeGreaterThan(0);
    expect((await r.prepaidSessions(LIN)).length).toBeGreaterThan(0);
    expect((await r.prepaidOffers(LIN, now())).length).toBeGreaterThan(0);
    await r.attestations(LIN, ["FITBOX_FUTIAN", "IRONPULSE_NANSHAN"]);
    expect((await r.riskSignals(LIN, ["IRONPULSE_NANSHAN"])).length).toBeGreaterThan(0);
  });

  it("RLS hides Lin's rows from another user", async () => {
    const r = repos();
    expect(await r.accounts(STRANGER)).toEqual([]);
    expect(await r.subscriptions(STRANGER)).toEqual([]);
    expect(await r.prepaidPlans(STRANGER)).toEqual([]);
    expect(await r.transactions(STRANGER, { from: "2000-01-01", to: "2100-01-01" })).toEqual([]);
  });

  it("view builders return api-types-shaped responses from seed data", async () => {
    S.SummaryResponse.parse(await buildSummary(d(), now().slice(0, 7)));
    const subs = S.SubscriptionsResponse.parse(await buildSubscriptions(d()));
    const gpt = subs.items.find((i) => i.merchant.name === "ChatGPT Plus");
    expect(gpt?.amount).toMatchObject({ currency: "USD", base: { currency: "CNY" } });
    S.RecommendationsResponse.parse(await buildRecommendations(d()));
    const plans = S.PrepaidPlansResponse.parse(await buildPrepaidPlans(d()));
    expect(plans.plans[0]).toMatchObject({ unitsTotal: 60, unitsRedeemed: 12, balanceInEscrow: { amount: 4800 } });
    expect(plans.plans[0].purchaseTx.simulated).toBe(true); // seed uses mock: escrow ids
    const offers = S.PrepaidOffersResponse.parse(await buildPrepaidOffers(d()));
    const fitbox = offers.offers.find((o) => o.merchant.id === "FITBOX_FUTIAN")!;
    const advice = S.PrepaidAdviceResponse.parse((await buildAdvice(d(), fitbox.id))!.advice);
    expect([advice.savings.amount, advice.breakEvenSessions, advice.expectedLossWithoutEscrow.amount]).toEqual([1500, 48, 300]);
  });

  it("keep flag: trial only, owner only (rolled back)", async () => {
    const rollbackTx = async <T>(userId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> => {
      const c = await pool.connect();
      try {
        await c.query("begin");
        await c.query("select set_config('app.user_id', $1, true)", [userId]);
        return await fn(c);
      } finally {
        await c.query("rollback");
        c.release();
      }
    };
    const r = createPgReadRepos(rollbackTx);
    const subs = await repos().subscriptions(LIN);
    const trial = subs.find((s) => s.status === "trial")!;
    const paid = subs.find((s) => s.status === "active")!;
    expect(await r.keepTrial(LIN, trial.id)).toBe("ok");
    expect(await r.keepTrial(LIN, paid.id)).toBe("not_trial");
    expect(await r.keepTrial(STRANGER, trial.id)).toBe("not_found");
  });

  it("FX upsert on (date, base, quote) and getRate staleness", async () => {
    const row = { date: "1999-01-04", base: "USD", quote: "CNY", rate: 8.2793, source: "fx_provider" as const, fetched_at: now() };
    try {
      await storeFxRates(pool, [row]);
      await storeFxRates(pool, [{ ...row, rate: 8.28 }]);
      const r = await getRate("USD", "CNY", "1999-01-08");
      expect(r).toMatchObject({ rate: 8.28, rateDate: "1999-01-04", staleDays: 4, stale: true });
    } finally {
      await pool.query("delete from public.fx_rates where date = '1999-01-04' and base = 'USD' and quote = 'CNY'");
    }
  });
});
