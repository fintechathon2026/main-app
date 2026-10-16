import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIN, OFFER, OTHER_USER, SUB, linRecommendationRows, linRepos } from "./lin-seed";
import * as S from "./api-schemas";

vi.mock("next/server", () => ({ connection: async () => {} }));

const repos = { current: linRepos() };
vi.mock("@/src/server/db/read/repos", () => ({ getReadRepos: () => repos.current }));

const { GET: summary } = await import("@/app/api/summary/route");
const { GET: subscriptions } = await import("@/app/api/subscriptions/route");
const { POST: keep } = await import("@/app/api/subscriptions/[id]/keep/route");
const { GET: recommendations } = await import("@/app/api/recommendations/route");
const { GET: plans } = await import("@/app/api/prepaid/plans/route");
const { GET: offers } = await import("@/app/api/prepaid/offers/route");
const { GET: advice } = await import("@/app/api/prepaid/offers/[id]/advice/route");

const req = (path: string, user: string | null = LIN, method = "GET") =>
  new Request(`http://localhost${path}`, { method, headers: user ? { "x-demo-user": user } : {} });
const params = <T>(p: T) => ({ params: Promise.resolve(p) }) as never;

beforeEach(async () => {
  vi.stubEnv("REINS_DEMO_AUTH", "1");
  vi.stubEnv("REINS_FIXTURES", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  repos.current = linRepos(await linRecommendationRows());
  vi.useFakeTimers({ now: new Date("2026-10-17T09:00:00.000Z"), toFake: ["Date"] });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("R1 read routes (database mode, fake repos)", () => {
  it("require a session", async () => {
    for (const r of [summary(req("/api/summary", null)), subscriptions(req("/api/subscriptions", null)), plans(req("/api/prepaid/plans", null))]) {
      expect((await r).status).toBe(401);
    }
  });

  it("GET /api/summary validates the period and matches the type", async () => {
    expect((await summary(req("/api/summary?period=2026-13"))).status).toBe(400);
    const res = await summary(req("/api/summary?period=2026-10"));
    expect(res.status).toBe(200);
    const body = S.SummaryResponse.parse(await res.json());
    expect(body.balanceAfterObligations.amount).toBe(5889);
    const def = S.SummaryResponse.parse(await (await summary(req("/api/summary"))).json());
    expect(def.period).toBe("2026-10");
  });

  it("GET /api/subscriptions filters by status", async () => {
    expect((await subscriptions(req("/api/subscriptions?status=bogus"))).status).toBe(400);
    const body = S.SubscriptionsResponse.parse(await (await subscriptions(req("/api/subscriptions?status=trial"))).json());
    expect(body.items.map((i) => i.id)).toEqual([SUB.tencent]);
  });

  it("POST /api/subscriptions/:id/keep: owner only, trials only", async () => {
    const ok = await keep(req(`/api/subscriptions/${SUB.tencent}/keep`, LIN, "POST"), params({ id: SUB.tencent }));
    expect(ok.status).toBe(200);
    expect(S.KeepTrialResponse.parse(await ok.json())).toEqual({ subscriptionId: SUB.tencent, keepFlag: true });
    const paid = await keep(req(`/api/subscriptions/${SUB.iqiyi}/keep`, LIN, "POST"), params({ id: SUB.iqiyi }));
    expect(paid.status).toBe(409);
    const foreign = await keep(req(`/api/subscriptions/${SUB.tencent}/keep`, OTHER_USER, "POST"), params({ id: SUB.tencent }));
    expect(foreign.status).toBe(404);
    // After keeping, the trial no longer has an auto-cancel date.
    const subs = S.SubscriptionsResponse.parse(await (await subscriptions(req("/api/subscriptions?status=trial"))).json());
    expect(subs.items[0].trial).toMatchObject({ keepFlag: true, autoCancelAt: null });
  });

  it("GET /api/recommendations and prepaid routes match their types", async () => {
    S.RecommendationsResponse.parse(await (await recommendations(req("/api/recommendations"))).json());
    S.PrepaidPlansResponse.parse(await (await plans(req("/api/prepaid/plans"))).json());
    const o = S.PrepaidOffersResponse.parse(await (await offers(req("/api/prepaid/offers"))).json());
    expect(o.offers).toHaveLength(2);
  });

  it("GET /api/prepaid/offers/:id/advice", async () => {
    const res = await advice(req(`/api/prepaid/offers/${OFFER.fitbox}/advice?expectedSessions=50`), params({ id: OFFER.fitbox }));
    const body = S.PrepaidAdviceResponse.parse(await res.json());
    expect(body).toMatchObject({ expectedSessions: 50, breakEvenSessions: 48, recommendation: "prepay_escrow" });
    expect((await advice(req(`/api/prepaid/offers/x/advice`), params({ id: "x" }))).status).toBe(404);
    expect((await advice(req(`/api/prepaid/offers/${OFFER.fitbox}/advice?expectedSessions=-1`), params({ id: OFFER.fitbox }))).status).toBe(400);
  });

  it("hides internal errors", async () => {
    repos.current = linRepos([], { accounts: async () => { throw new Error("db down: secret detail"); } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await summary(req("/api/summary?period=2026-10"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal_error" });
  });
});

describe("REINS_FIXTURES=1", () => {
  it("serves fixtures without a session or database", async () => {
    vi.stubEnv("REINS_FIXTURES", "1");
    repos.current = linRepos([], { settings: async () => { throw new Error("must not be called"); } });
    S.SummaryResponse.parse(await (await summary(req("/api/summary", null))).json());
    S.SubscriptionsResponse.parse(await (await subscriptions(req("/api/subscriptions", null))).json());
    S.RecommendationsResponse.parse(await (await recommendations(req("/api/recommendations", null))).json());
    S.PrepaidPlansResponse.parse(await (await plans(req("/api/prepaid/plans", null))).json());
    S.PrepaidOffersResponse.parse(await (await offers(req("/api/prepaid/offers", null))).json());
    S.PrepaidAdviceResponse.parse(await (await advice(req("/x", null), params({ id: OFFER.fitbox }))).json());
    expect((await advice(req("/x", null), params({ id: "other" }))).status).toBe(404);
    const k = await keep(req("/x", null, "POST"), params({ id: "abc" }));
    expect(await k.json()).toEqual({ subscriptionId: "abc", keepFlag: true });
  });
});
