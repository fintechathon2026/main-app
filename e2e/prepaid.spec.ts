import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { verifyTypedData, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { PURCHASE_AUTH_TYPES, REDEEM_TYPES, VOLUNTARY_EXIT_TYPES, offerHash, type OfferJson } from "../src/server/chain/types";

// Prepaid buy, check in, exit (task.md R4-07, R4-09, R4-10).
//
// The real browser code runs: the page generates a consumer key in IndexedDB and signs EIP-712
// messages with viem. That works headless in Chromium (IndexedDB, Web Crypto and viem are plain
// browser code), so nothing about the signing is stubbed. What is stubbed is only the server side,
// which needs a session and a database: wallet, signing config, the gym simulator, and the three
// action routes. The stub verifies the signatures it receives, as the executor would.

const readJson = <T>(file: string) => JSON.parse(readFileSync(`fixtures/api/${file}`, "utf8")) as T;
type Plan = Record<string, unknown> & { id: string; chainPlanId: string; unitsRedeemed: number; status: string };
const planFixture = readJson<{ baseCurrency: string; plans: Plan[] }>("prepaid-plans.json");
const offersFixture = readJson<{ offers: { id: string; merchant: { name: string } }[] }>("prepaid-offers.json");
const adviceFixture = readJson<{ offerId: string }>("prepaid-offer-advice.json");

const OFFER_ID = "0f000000-0000-4000-8000-000000000001"; // FitBox Futian, money held safely
const NEW_PLAN_ID = "9a000000-0000-4000-8000-000000000002";
const NEW_CHAIN_PLAN_ID = "2";

const AGENT = "0x00000000000000000000000000000000000000a1" as Address;
const DOMAIN = { name: "PrepaidEscrow", version: "1", chainId: 31337, verifyingContract: "0x00000000000000000000000000000000000000e5" as Address };
const GYM_OFFER: OfferJson = {
  merchant: "0x00000000000000000000000000000000000000b2",
  unitPrice: 10_000,
  units: 60,
  cancelFeeBps: 1000,
  expiresAt: 4_102_444_800,
  nonce: "7",
};
const MERCHANT_SIG = `0x${"ab".repeat(65)}` as Hex;
const GYM_CHECKIN_SIG = `0x${"cd".repeat(65)}` as Hex;
const TX = { hash: `0x${"5e".repeat(32)}`, simulated: true };

const detail = (page: Page) => page.locator("aside:visible, [role=dialog]:visible");
const ok = (body: unknown, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

type Seen = { method: string; url: string; path: string; body: unknown; raw: string | null };
type Outcome = { status: "succeeded" | "denied" | "awaiting_approval" | "failed"; ruleIds?: string[] };

/** Stubs every session-bound prepaid route and records everything the page sends. */
async function stubPrepaid(page: Page, opts: { purchase?: Outcome; noGymOffer?: boolean } = {}) {
  const seen: Seen[] = [];
  const everything: Seen[] = [];
  const plans: Plan[] = structuredClone(planFixture.plans);
  const result = (o: Outcome | undefined, planId: string) => ({
    actionId: "ac000000-0000-4000-8000-000000000001",
    planId,
    status: (o ?? { status: "succeeded" }).status,
    decision: (o ?? { status: "succeeded" }).status === "denied" ? "deny" : "allow",
    ruleIds: o?.ruleIds ?? [],
    tx: !o || o.status === "succeeded" ? TX : null,
  });

  // Seen by the browser, not by the stub: also covers requests that no route handles.
  page.on("request", (r) => {
    const u = new URL(r.url());
    everything.push({ method: r.method(), url: r.url(), path: u.pathname, body: safeJson(r.postData()), raw: r.postData() });
  });

  await page.route("**/api/prepaid/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const body = safeJson(req.postData());
    seen.push({ method: req.method(), url: req.url(), path, body, raw: req.postData() });

    if (path === "/api/prepaid/plans") return route.fulfill(ok({ baseCurrency: planFixture.baseCurrency, plans }));
    if (path === "/api/prepaid/offers") return route.fulfill(ok(offersFixture));
    if (path.endsWith("/advice")) return route.fulfill(path.includes(adviceFixture.offerId) ? ok(adviceFixture) : ok({}, 404));
    if (path === "/api/prepaid/signing") {
      return route.fulfill(ok({ mode: "mock", domain: DOMAIN, token: null, agent: AGENT, rpcUrl: null, explorerTxBase: null }));
    }
    if (path === "/api/prepaid/wallet") return route.fulfill(ok({ address: (body as { address: string }).address, changed: true }));
    if (path === "/api/prepaid/gym/offer") {
      return opts.noGymOffer ? route.fulfill(ok({ error: "no signed offer", code: "no_signed_offer" }, 404)) : route.fulfill(ok({ offer: GYM_OFFER, merchantSig: MERCHANT_SIG }));
    }
    if (path === "/api/prepaid/purchase") {
      if ((opts.purchase ?? { status: "succeeded" }).status === "succeeded") {
        plans.push({ ...planFixture.plans[0], id: NEW_PLAN_ID, chainPlanId: NEW_CHAIN_PLAN_ID, unitsRedeemed: 0, sessions: [] });
      }
      return route.fulfill(ok(result(opts.purchase, NEW_PLAN_ID)));
    }
    const checkinTablet = path.match(/^\/api\/prepaid\/gym\/checkin\/([^/]+)$/);
    if (checkinTablet) {
      const p = plans.find((x) => x.id === checkinTablet[1])!;
      return route.fulfill(ok({ planId: p.chainPlanId, sessionNo: p.unitsRedeemed + 1, deadline: Math.floor(Date.now() / 1000) + 600, merchantSig: GYM_CHECKIN_SIG }));
    }
    const checkin = path.match(/^\/api\/prepaid\/plans\/([^/]+)\/checkin$/);
    if (checkin) {
      plans.find((x) => x.id === checkin[1])!.unitsRedeemed += 1;
      return route.fulfill(ok(result(undefined, checkin[1])));
    }
    const exit = path.match(/^\/api\/prepaid\/plans\/([^/]+)\/exit$/);
    if (exit) {
      const p = plans.find((x) => x.id === exit[1])!;
      Object.assign(p, { status: "exited_voluntary", refund: { amount: 5400, currency: "CNY" } });
      return route.fulfill(ok(result(undefined, exit[1])));
    }
    return route.fulfill(ok({ error: "not stubbed" }, 404));
  });
  return { seen, everything, calls: (path: string | RegExp) => seen.filter((s) => (typeof path === "string" ? s.path === path : path.test(s.path))) };
}

function safeJson(s: string | null): unknown {
  try {
    return s ? JSON.parse(s) : undefined;
  } catch {
    return undefined;
  }
}

/** The private key the page holds, read straight from its IndexedDB. */
async function storedKey(page: Page): Promise<Hex | null> {
  return page.evaluate(
    () =>
      new Promise<string | null>((resolve, reject) => {
        const open = indexedDB.open("reins-keys", 1);
        open.onerror = () => reject(open.error);
        open.onupgradeneeded = () => {
          open.result.createObjectStore("keys");
        };
        open.onsuccess = () => {
          const get = open.result.transaction("keys", "readonly").objectStore("keys").get("consumer");
          get.onsuccess = () => resolve(typeof get.result === "string" ? get.result : null);
          get.onerror = () => reject(get.error);
        };
      }),
  ) as Promise<Hex | null>;
}

const HEX64 = /^(0x)?[0-9a-f]{64}$/i;
const SECRET_NAMES = /priv|secret|mnemonic|seed|backup|password/i;

/** Every string leaf of a JSON value, with its dotted path. */
function leaves(v: unknown, path = ""): { path: string; value: string }[] {
  if (typeof v === "string") return [{ path, value: v }];
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => leaves(x, path ? `${path}.${k}` : k));
  return [];
}
function keyNames(v: unknown): string[] {
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => [k, ...keyNames(x)]);
  return [];
}

test.describe("prepaid: buy, check in, leave", () => {
  test("buys with a key made in the browser, then checks in and leaves; no secret leaves the browser", async ({ page }) => {
    const server = await stubPrepaid(page);
    await page.goto("/prepaid");
    await expect(page.getByRole("heading", { name: "Prepaid", level: 1 })).toBeVisible();

    // ---- Buy -------------------------------------------------------------------------------
    expect(await storedKey(page)).toBeNull(); // no key until the first purchase
    await page.getByRole("button", { name: /FitBox Futian.*money held safely/ }).click();
    await expect(detail(page).getByRole("heading", { name: "FitBox Futian" })).toBeVisible();
    await detail(page).getByRole("button", { name: "Buy with money held safely" }).click();
    await expect(detail(page).getByText("You sign the purchase in this browser.")).toBeVisible();
    expect(server.calls("/api/prepaid/purchase")).toHaveLength(0); // asking to buy is not buying

    await detail(page).getByRole("button", { name: "Sign and buy" }).click();
    await expect(detail(page).getByRole("status").filter({ hasText: "Bought. The money is held safely" })).toBeVisible();

    // The key was generated in this browser's IndexedDB, and only its address was registered.
    const key = await storedKey(page);
    expect(key).toMatch(/^0x[0-9a-f]{64}$/i);
    const account = privateKeyToAccount(key!);
    const wallet = server.calls("/api/prepaid/wallet");
    expect(wallet).toHaveLength(1);
    expect(wallet[0].body).toEqual({ address: account.address });

    // The purchase body carries the gym's offer and the owner's signature, and nothing else.
    const [purchase] = server.calls("/api/prepaid/purchase");
    const pb = purchase.body as { offerId: string; offer: OfferJson; merchantSig: Hex; auth: { offerHash: Hex; consumer: Address; agent: Address; deadline: number }; consumerSig: Hex };
    expect(Object.keys(pb).sort()).toEqual(["auth", "consumerSig", "merchantSig", "offer", "offerId"]);
    expect(pb.offerId).toBe(OFFER_ID);
    expect(pb.offer).toEqual(GYM_OFFER);
    expect(pb.merchantSig).toBe(MERCHANT_SIG);
    expect(pb.auth.consumer).toBe(account.address);
    expect(pb.auth.agent).toBe(AGENT);
    expect(pb.auth.offerHash).toBe(offerHash(DOMAIN, GYM_OFFER));
    expect(pb.auth.deadline).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(
      await verifyTypedData({
        address: account.address,
        domain: DOMAIN,
        types: PURCHASE_AUTH_TYPES,
        primaryType: "PurchaseAuth",
        message: { ...pb.auth, deadline: BigInt(pb.auth.deadline) },
        signature: pb.consumerSig,
      }),
    ).toBe(true);

    // ---- Check in --------------------------------------------------------------------------
    // The new package shows up after the reload. On a phone the offer sheet covers the list.
    const close = page.getByRole("dialog").getByRole("button", { name: "Close", exact: true });
    if (await close.isVisible()) await close.click();
    await page.getByRole("button", { name: /FitBox Futian.*(?<!\d)0 of 60 used/ }).click();
    await expect(detail(page).getByText("0 of 60 used")).toBeVisible();

    await detail(page).getByRole("button", { name: "Check in at the gym" }).click();
    await expect(detail(page).getByRole("status").filter({ hasText: "Session 1 used. One session price went to the gym." })).toBeVisible();
    const [checkin] = server.calls(/\/checkin$/).filter((s) => s.path.startsWith("/api/prepaid/plans/"));
    expect(checkin.path).toBe(`/api/prepaid/plans/${NEW_PLAN_ID}/checkin`);
    const cb = checkin.body as { sessionNo: number; deadline: number; consumerSig: Hex; merchantSig: Hex };
    expect(Object.keys(cb).sort()).toEqual(["consumerSig", "deadline", "merchantSig", "sessionNo"]);
    expect(cb.merchantSig).toBe(GYM_CHECKIN_SIG); // the gym's half is passed on untouched
    expect(
      await verifyTypedData({
        address: account.address,
        domain: DOMAIN,
        types: REDEEM_TYPES,
        primaryType: "Redeem",
        message: { planId: BigInt(NEW_CHAIN_PLAN_ID), sessionNo: cb.sessionNo, deadline: BigInt(cb.deadline) },
        signature: cb.consumerSig,
      }),
    ).toBe(true);

    // ---- Leave -----------------------------------------------------------------------------
    await detail(page).getByRole("button", { name: "Leave this package" }).click();
    await expect(detail(page).getByText(/Leave now\? The gym keeps a/)).toBeVisible();
    expect(server.calls(/\/exit$/)).toHaveLength(0); // asking to leave is not leaving

    await detail(page).getByRole("button", { name: "Sign and leave" }).click();
    await expect(detail(page).getByText("is back in your wallet.")).toBeVisible();
    await expect(detail(page).getByText("You left the package")).toBeVisible();
    const [exit] = server.calls(/\/exit$/);
    expect(exit.path).toBe(`/api/prepaid/plans/${NEW_PLAN_ID}/exit`);
    const eb = exit.body as { deadline: number; consumerSig: Hex };
    expect(Object.keys(eb).sort()).toEqual(["consumerSig", "deadline"]);
    expect(
      await verifyTypedData({
        address: account.address,
        domain: DOMAIN,
        types: VOLUNTARY_EXIT_TYPES,
        primaryType: "VoluntaryExit",
        message: { planId: BigInt(NEW_CHAIN_PLAN_ID), deadline: BigInt(eb.deadline) },
        signature: eb.consumerSig,
      }),
    ).toBe(true);

    // ---- No secret in anything the browser sent ---------------------------------------------
    // Checked against every request of the page (not only /api/prepaid/*), URLs included.
    const bare = key!.slice(2).toLowerCase();
    expect(server.everything.length).toBeGreaterThan(5);
    for (const r of server.everything) {
      const text = `${r.url}\n${r.raw ?? ""}`.toLowerCase();
      expect(text, `${r.method} ${r.path} must not carry the private key`).not.toContain(bare);
      expect(keyNames(r.body).filter((k) => SECRET_NAMES.test(k)), `${r.method} ${r.path} field names`).toEqual([]);
      for (const l of leaves(r.body)) {
        // A 32-byte value may only be the public offer hash; signatures are 65 bytes and
        // addresses 20, so a bare 64-hex string is where a private key would hide.
        if (HEX64.test(l.value)) {
          expect(l.path, `${r.method} ${r.path} has an unexpected 32-byte value`).toBe("auth.offerHash");
          expect(l.value).toBe(offerHash(DOMAIN, GYM_OFFER));
        }
      }
    }
  });

  test("checking in without the key in this browser says so and sends nothing", async ({ page }) => {
    const server = await stubPrepaid(page);
    await page.goto("/prepaid");
    await page.getByRole("button", { name: /FitBox Futian.*12 of 60 used/ }).click();
    await detail(page).getByRole("button", { name: "Check in at the gym" }).click();
    await expect(detail(page).getByRole("status")).toContainText("This browser does not hold the key for this package. Restore your key backup first. Nothing was paid.");
    expect(server.calls(/\/checkin$/)).toHaveLength(0);
    expect(server.calls("/api/prepaid/wallet")).toHaveLength(0);
    expect(await storedKey(page)).toBeNull(); // a missing key is never replaced by a new one for an existing package
  });

  test("a purchase the Gate blocks shows the rule and no success", async ({ page }) => {
    const server = await stubPrepaid(page, { purchase: { status: "denied", ruleIds: ["prepaid.over_max_prepay"] } });
    await page.goto("/prepaid");
    await page.getByRole("button", { name: /FitBox Futian.*money held safely/ }).click();
    await detail(page).getByRole("button", { name: "Buy with money held safely" }).click();
    await detail(page).getByRole("button", { name: "Sign and buy" }).click();

    await expect(detail(page).getByRole("status")).toHaveText("Blocked. This is over your prepaid limit. Nothing was paid.");
    expect(server.calls("/api/prepaid/purchase")).toHaveLength(1);
    await expect(detail(page).getByText(/Bought\./)).toHaveCount(0);
  });

  test("a purchase that needs approval sends the user to Home", async ({ page }) => {
    await stubPrepaid(page, { purchase: { status: "awaiting_approval" } });
    await page.goto("/prepaid");
    await page.getByRole("button", { name: /FitBox Futian.*money held safely/ }).click();
    await detail(page).getByRole("button", { name: "Buy with money held safely" }).click();
    await detail(page).getByRole("button", { name: "Sign and buy" }).click();
    await expect(detail(page).getByRole("status")).toHaveText("This needs your OK first. It is waiting in Home.");
  });

  test("when the gym has no signed offer nothing is signed and no key is made", async ({ page }) => {
    const server = await stubPrepaid(page, { noGymOffer: true });
    await page.goto("/prepaid");
    await page.getByRole("button", { name: /FitBox Futian.*money held safely/ }).click();
    await detail(page).getByRole("button", { name: "Buy with money held safely" }).click();
    await detail(page).getByRole("button", { name: "Sign and buy" }).click();

    await expect(detail(page).getByRole("status")).toHaveText("The gym has no signed offer right now. Nothing was paid.");
    expect(server.calls("/api/prepaid/purchase")).toHaveLength(0);
    expect(server.calls("/api/prepaid/wallet")).toHaveLength(0);
    expect(await storedKey(page)).toBeNull();
  });

  test("an offer without safe holding cannot be bought", async ({ page }) => {
    await stubPrepaid(page);
    await page.goto("/prepaid");
    await page.getByRole("button", { name: /IronPulse Nanshan.*no safe holding/ }).click();
    await expect(detail(page).getByText("This gym does not hold the money safely, so Reins cannot buy it for your rules.")).toBeVisible();
    await expect(detail(page).getByRole("button", { name: /Buy/ })).toHaveCount(0);
  });

  test("on sample data (no session) there are no buy, check-in or leave buttons", async ({ page }) => {
    // Without a session the read routes answer 401 and the page falls back to labelled samples.
    await page.route(/\/api\/prepaid\/(plans|offers)$/, (route) => route.fulfill(ok({ error: "unauthorized" }, 401)));
    await page.goto("/prepaid");
    await page.getByRole("button", { name: /FitBox Futian.*money held safely/ }).click();
    await expect(detail(page).getByText("Sign in to buy. This is sample data.")).toBeVisible();
    await expect(detail(page).getByRole("button", { name: /Buy|Check in|Leave/ })).toHaveCount(0);
  });
});
