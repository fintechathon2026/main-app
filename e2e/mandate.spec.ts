import { readFileSync } from "node:fs";
import { expect, test, type Page, type Request } from "@playwright/test";

// Mandate edit (task.md R4-10). The compile route needs a session, so the answer is a stub with
// the real response shape (MandateCompileResponse). The rest is the real UI reading fixtures.
const compiled = JSON.parse(readFileSync("fixtures/api/mandates-compile.json", "utf8")) as {
  baseCurrency: string;
  policy: unknown;
  defaulted: string[];
  readback: string[];
};
const READBACK = [
  "Pay bills automatically up to CNY 200 each; larger or unusual bills need your approval.",
  "Total payments per day stay at or below CNY 500.",
];
const draft = { ...compiled, readback: READBACK };

const sheet = (page: Page) => page.getByRole("dialog", { name: "Change your rules" });

/** Every request that is not a plain read, so "nothing was activated" can be checked. */
function watchWrites(page: Page) {
  const writes: Request[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.method() !== "HEAD") writes.push(r);
  });
  return writes;
}

async function openSheet(page: Page) {
  await page.goto("/");
  await page.locator("a[href='/rules']:visible").first().click();
  await expect(page).toHaveURL(/\/rules$/);
  await expect(page.getByRole("heading", { name: "Your rules", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Change rules" }).click();
  await expect(sheet(page)).toBeVisible();
}

test.describe("mandate edit", () => {
  test("reads the change back as rules and activates nothing", async ({ page }) => {
    const writes = watchWrites(page);
    const bodies: unknown[] = [];
    await page.route("**/api/mandates/compile", async (route) => {
      bodies.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(draft) });
    });
    await openSheet(page);
    const versionBefore = await page.getByText(/^Version\s*\d+, signed by you/).first().innerText();

    // Nothing to read back until there is a change typed.
    await expect(sheet(page).getByRole("button", { name: "Read it back to me" })).toBeDisabled();
    await sheet(page).getByLabel("What should change?").fill("Pay bills under 200 yuan without asking");
    await sheet(page).getByRole("button", { name: "Read it back to me" }).click();

    const readback = sheet(page).getByRole("region", { name: /Read back/ });
    await expect(readback).toBeVisible();
    for (const line of READBACK) await expect(readback.getByText(line)).toBeVisible();
    await expect(readback.getByText(`${draft.defaulted.length}`, { exact: true })).toBeVisible();
    await expect(readback.getByText("Signing a new version is not available yet. Your current rules stay in force.")).toBeVisible();

    // The only write is the compile call, with exactly the typed words. There is no sign or
    // activate button, and no request that could activate a version.
    expect(bodies).toEqual([{ text: "Pay bills under 200 yuan without asking" }]);
    expect(writes.map((r) => `${r.method()} ${new URL(r.url()).pathname}`)).toEqual(["POST /api/mandates/compile"]);
    await expect(sheet(page).getByRole("button", { name: /sign|activate|confirm|save|apply/i })).toHaveCount(0);
    await expect(sheet(page).getByRole("button", { name: "Read it again" })).toBeVisible();

    // Closing leaves the signed rules as they were.
    await sheet(page).getByRole("button", { name: "Close", exact: true }).last().click();
    await expect(sheet(page)).toBeHidden();
    await expect(page.getByText(/^Version\s*\d+, signed by you/).first()).toHaveText(versionBefore);
    expect(writes).toHaveLength(1);
  });

  test("editing the words clears an old read-back before it can be mistaken for the new text", async ({ page }) => {
    await page.route("**/api/mandates/compile", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(draft) }),
    );
    await openSheet(page);
    await sheet(page).getByLabel("What should change?").fill("Pay bills under 200 yuan");
    await sheet(page).getByRole("button", { name: "Read it back to me" }).click();
    await expect(sheet(page).getByRole("region", { name: /Read back/ })).toBeVisible();

    await sheet(page).getByLabel("What should change?").fill("Pay bills under 300 yuan");
    await expect(sheet(page).getByRole("region", { name: /Read back/ })).toHaveCount(0);
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
    expect(writes.map((r) => `${r.method()} ${new URL(r.url()).pathname}`)).toEqual(["POST /api/mandates/compile"]);

    // The user can try again; a good answer then replaces the error.
    await page.unroute("**/api/mandates/compile");
    await page.route("**/api/mandates/compile", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(draft) }),
    );
    await sheet(page).getByRole("button", { name: "Read it back to me" }).click();
    await expect(sheet(page).getByRole("region", { name: /Read back/ })).toBeVisible();
    await expect(sheet(page).getByRole("alert")).toHaveCount(0);
  });
});
