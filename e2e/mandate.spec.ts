import { readFileSync } from "node:fs";
import { expect, test, type Page, type Request } from "@playwright/test";

// Mandate edit and signing (task.md R4-10, R4-04). The compile and activate routes need a
// session, so their answers are stubs with the real response shapes (MandateCompileResponse,
// MandateActivateResponse). The rest is the real UI reading fixtures.
const read = (f: string) => JSON.parse(readFileSync(`fixtures/api/${f}`, "utf8"));
const compiled = read("mandates-compile.json") as {
  baseCurrency: string;
  policy: { bills: Record<string, unknown> } & Record<string, unknown>;
  defaulted: string[];
  readback: string[];
};
const activeFixture = read("mandates-active.json") as { version: number } & Record<string, unknown>;
const historyFixture = read("mandates-history.json") as { version: number; status: string }[];

const READBACK = [
  "Pay bills automatically up to CNY 200 each; larger or unusual bills need your approval.",
  "Total payments per day stay at or below CNY 500.",
];
/** Lowers the daily limit from Lin's ¥1,000 to ¥500: less permission, signs at once. */
const narrowing = {
  ...compiled,
  readback: READBACK,
  relation: "narrowing",
  changes: [{ path: "global.daily_outflow_cap", direction: "narrower" }],
};
/** Raises auto-pay from ¥300 to ¥1,000: more permission, needs the 10-second review. */
const widening = {
  ...compiled,
  policy: { ...compiled.policy, bills: { ...compiled.policy.bills, auto_pay_max: 1000 } },
  readback: ["Pay bills automatically up to CNY 1,000 each; larger or unusual bills need your approval."],
  relation: "widening",
  changes: [{ path: "bills.auto_pay_max", direction: "wider" }],
};
const SIGNED = { version: 4, hash: "b".repeat(64), signedAt: "2026-10-19T03:00:00.000Z" };

const sheet = (page: Page) => page.getByRole("dialog", { name: "Change your rules" });
const signButton = (page: Page) => sheet(page).getByRole("button", { name: /^Sign/ });

/** Every request that is not a plain read, so "nothing was activated" can be checked. */
function watchWrites(page: Page) {
  const writes: Request[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.method() !== "HEAD") writes.push(r);
  });
  return writes;
}
const paths = (writes: Request[]) => writes.map((r) => `${r.method()} ${new URL(r.url()).pathname}`);

async function stubCompile(page: Page, body: unknown) {
  await page.route("**/api/mandates/compile", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }),
  );
}

/**
 * Stubs activate (201 with `relation`) and, once it has been called, serves the new version from
 * /active and /history the way the live routes would.
 */
async function stubActivate(page: Page, relation: string, direction: "less" | "more", change: string) {
  const bodies: unknown[] = [];
  await page.route("**/api/mandates/activate", async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ...SIGNED, relation }) });
  });
  await page.route("**/api/mandates/active", (route) =>
    bodies.length
      ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...activeFixture, version: 4, signedAt: SIGNED.signedAt }) })
      : route.fallback(),
  );
  await page.route("**/api/mandates/history", (route) =>
    bodies.length
      ? route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            { version: 4, signedAt: SIGNED.signedAt, change, direction, status: "active" },
            ...historyFixture.map((v) => ({ ...v, status: "superseded" })),
          ]),
        })
      : route.fallback(),
  );
  return bodies;
}

async function openSheet(page: Page) {
  await page.goto("/");
  await page.locator("a[href='/rules']:visible").first().click();
  await expect(page).toHaveURL(/\/rules$/);
  await expect(page.getByRole("heading", { name: "Your rules", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Change rules" }).click();
  await expect(sheet(page)).toBeVisible();
}

async function readBack(page: Page, text: string) {
  await sheet(page).getByLabel("What should change?").fill(text);
  await sheet(page).getByRole("button", { name: "Read it back to me" }).click();
  await expect(sheet(page).getByRole("region", { name: /Read back/ })).toBeVisible();
}

test.describe("mandate edit", () => {
  test("reads the change back as rules with the diff, and activates nothing until signed", async ({ page }) => {
    const writes = watchWrites(page);
    const bodies: unknown[] = [];
    await page.route("**/api/mandates/compile", async (route) => {
      bodies.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(narrowing) });
    });
    await openSheet(page);
    const versionBefore = await page.getByText(/^Version\s*\d+, signed by you/).first().innerText();

    // Nothing to read back until there is a change typed.
    await expect(sheet(page).getByRole("button", { name: "Read it back to me" })).toBeDisabled();
    await readBack(page, "Pay bills under 200 yuan without asking");

    const readback = sheet(page).getByRole("region", { name: /Read back/ });
    for (const line of READBACK) await expect(readback.getByText(line)).toBeVisible();
    await expect(readback.getByText(`${narrowing.defaulted.length}`, { exact: true })).toBeVisible();

    const changes = sheet(page).getByRole("region", { name: "What changes" });
    await expect(changes.getByText("Daily limit")).toBeVisible();
    await expect(changes.getByText("¥1,000 → ¥500")).toBeVisible();
    await expect(changes.getByText("Less permission", { exact: true })).toBeVisible();

    // The only write is the compile call, with exactly the typed words.
    expect(bodies).toEqual([{ text: "Pay bills under 200 yuan without asking" }]);
    expect(paths(writes)).toEqual(["POST /api/mandates/compile"]);
    await expect(signButton(page)).toBeEnabled();
    await expect(sheet(page).getByRole("button", { name: "Read it again" })).toBeVisible();

    // Closing without signing leaves the signed rules as they were.
    await sheet(page).getByRole("button", { name: "Close", exact: true }).last().click();
    await expect(sheet(page)).toBeHidden();
    await expect(page.getByText(/^Version\s*\d+, signed by you/).first()).toHaveText(versionBefore);
    expect(writes).toHaveLength(1);
  });

  test("a narrowing change signs at once and the history shows less permission", async ({ page }) => {
    const writes = watchWrites(page);
    await stubCompile(page, narrowing);
    const signed = await stubActivate(page, "narrowing", "less", "Daily limit lowered from ¥1,000 to ¥500");
    await openSheet(page);
    await readBack(page, "Never more than 500 a day");

    await signButton(page).click();
    await expect(sheet(page)).toBeHidden();
    expect(signed).toEqual([{ policy: narrowing.policy, createdVia: "nl" }]);
    expect(paths(writes)).toEqual(["POST /api/mandates/compile", "POST /api/mandates/activate"]);

    await expect(page.getByText(/^Version\s*4, signed by you/).first()).toBeVisible();
    const history = page.locator("li", { hasText: "Daily limit lowered from ¥1,000 to ¥500" }).filter({ visible: true });
    await expect(history.getByText(/Less permission/)).toBeVisible();
  });

  test("a widening change is a warning with a 10-second review before Sign", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-10-19T03:00:00.000Z") });
    await stubCompile(page, widening);
    const signed = await stubActivate(page, "widening", "more", "Auto-pay limit raised from ¥300 to ¥1,000");
    await openSheet(page);
    await page.clock.pauseAt(new Date("2026-10-19T03:05:00.000Z"));
    await readBack(page, "Pay bills up to 1000 yuan without asking");

    const changes = sheet(page).getByRole("region", { name: "This gives Reins more permission" });
    await expect(changes).toBeVisible();
    await expect(changes.getByText("¥300 → ¥1,000")).toBeVisible();
    await expect(changes.getByText("More permission", { exact: true })).toBeVisible();

    await expect(signButton(page)).toBeDisabled();
    await expect(signButton(page)).toHaveText("Sign in 10 s");
    await page.clock.runFor(9_000);
    await expect(signButton(page)).toHaveText("Sign in 1 s");
    await expect(signButton(page)).toBeDisabled();
    expect(signed).toEqual([]);

    await page.clock.runFor(1_000);
    await expect(signButton(page)).toBeEnabled();
    await expect(signButton(page)).toHaveText("Sign these rules");
    await signButton(page).click();
    await expect(sheet(page)).toBeHidden();
    expect(signed).toEqual([{ policy: widening.policy, createdVia: "nl", confirmWidening: true }]);
    const history = page.locator("li", { hasText: "Auto-pay limit raised from ¥300 to ¥1,000" }).filter({ visible: true });
    await expect(history.getByText(/More permission/)).toBeVisible();
  });

  test("a failed signing says the rules did not change", async ({ page }) => {
    await stubCompile(page, narrowing);
    await page.route("**/api/mandates/activate", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "internal_error" }) }),
    );
    await openSheet(page);
    const versionBefore = await page.getByText(/^Version\s*\d+, signed by you/).first().innerText();
    await readBack(page, "Never more than 500 a day");
    await signButton(page).click();
    await expect(sheet(page).getByRole("alert")).toHaveText("Signing did not go through. Your rules did not change.");
    await expect(sheet(page)).toBeVisible();
    await expect(page.getByText(/^Version\s*\d+, signed by you/).first()).toHaveText(versionBefore);
  });

  test("editing the words clears an old read-back before it can be mistaken for the new text", async ({ page }) => {
    await stubCompile(page, narrowing);
    await openSheet(page);
    await readBack(page, "Pay bills under 200 yuan");

    await sheet(page).getByLabel("What should change?").fill("Pay bills under 300 yuan");
    await expect(sheet(page).getByRole("region", { name: /Read back/ })).toHaveCount(0);
    await expect(signButton(page)).toHaveCount(0);
  });

  test("a failed compile says the rules did not change", async ({ page }) => {
    const writes = watchWrites(page);
    await page.route("**/api/mandates/compile", (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "model unavailable", code: "model_unavailable" }) }),
    );
    await openSheet(page);
    await sheet(page).getByLabel("What should change?").fill("Pay bills under 200 yuan without asking");
    await sheet(page).getByRole("button", { name: "Read it back to me" }).click();

    await expect(sheet(page).getByRole("alert")).toHaveText("Reins could not read this change. Your rules did not change.");
    await expect(sheet(page).getByRole("region", { name: /Read back/ })).toHaveCount(0);
    expect(paths(writes)).toEqual(["POST /api/mandates/compile"]);

    // The user can try again; a good answer then replaces the error.
    await page.unroute("**/api/mandates/compile");
    await stubCompile(page, narrowing);
    await sheet(page).getByRole("button", { name: "Read it back to me" }).click();
    await expect(sheet(page).getByRole("region", { name: /Read back/ })).toBeVisible();
    await expect(sheet(page).getByRole("alert")).toHaveCount(0);
  });
});
