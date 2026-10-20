import { expect, test, type Page } from "@playwright/test";

// The approvals route needs a session, so decisions are answered by a stub. Everything else is
// the real UI reading fixtures and labelled sample data.
async function stubDecision(page: Page, status: 200 | 409, body: Record<string, unknown> = {}) {
  const calls: unknown[] = [];
  await page.route("**/api/approvals/a0000000-*", async (route) => {
    calls.push(route.request().postDataJSON());
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  return calls;
}

// The detail is a right pane on desktop and a bottom sheet on a phone; the other one is hidden.
const detail = (page: Page) => page.locator("aside:visible, [role=dialog]:visible");

const approved = { approvalId: "a0000000-0000-4000-8000-000000000001", status: "approved", planId: null, resume: null };

test.describe("bill with approval", () => {
  test("shows what will happen, then approves exactly that bill", async ({ page }) => {
    const calls = await stubDecision(page, 200, approved);
    await page.goto("/");
    await page.getByRole("button", { name: /Pay Landlord Wang/ }).click();

    await expect(detail(page).getByText("Bills over your auto-pay limit need your OK")).toBeVisible();
    await expect(detail(page).getByText(/saved payee/)).toBeVisible();

    await detail(page).getByRole("button", { name: "Approve ¥3,500.00" }).click();
    await expect(detail(page).getByRole("status").filter({ hasText: "Approved" })).toBeVisible();
    expect(calls).toEqual([{ decision: "approve" }]);
  });

  test("declining sends a reject and nothing happens", async ({ page }) => {
    const calls = await stubDecision(page, 200, { ...approved, status: "rejected" });
    await page.goto("/");
    await page.getByRole("button", { name: /Pay Landlord Wang/ }).click();
    await detail(page).getByRole("button", { name: "Decline" }).click();
    await expect(detail(page).getByText("Declined")).toBeVisible();
    expect(calls).toEqual([{ decision: "reject" }]);
  });

  test("an already answered request says so and pays nothing", async ({ page }) => {
    await stubDecision(page, 409);
    await page.goto("/");
    await page.getByRole("button", { name: /Pay Landlord Wang/ }).click();
    await detail(page).getByRole("button", { name: "Approve ¥3,500.00" }).click();
    await expect(detail(page).getByRole("alert")).toHaveText("This request was already answered.");
  });
});

test.describe("attack PDF blocked", () => {
  test("the blocked payment shows the rule that stopped it and has no approve button", async ({ page }) => {
    await page.goto("/activity");
    await page.getByRole("button", { name: /Payment to a new account/ }).click();

    await expect(detail(page).getByRole("heading", { name: "Rule check" })).toBeVisible();
    await expect(detail(page).getByText("The account is not in your saved payees", { exact: true })).toBeVisible();
    await expect(detail(page).getByText("Blocked").first()).toBeVisible();
    await expect(detail(page).getByText("Agent's note")).toHaveCount(0);
    await expect(detail(page).getByRole("button", { name: /Approve/ })).toHaveCount(0);
  });
});

test.describe("cancel subscription", () => {
  test("asks for an OK first, then cancels only after it", async ({ page }) => {
    const calls = await stubDecision(page, 200, { ...approved, approvalId: "a0000000-0000-4000-8000-000000000002" });
    await page.goto("/");
    await page.getByRole("button", { name: /Cancel iQIYI/ }).click();
    await expect(detail(page).getByRole("button", { name: "Keep it" })).toBeVisible();
    expect(calls).toEqual([]);

    await detail(page).getByRole("button", { name: "Cancel it" }).click();
    await expect(detail(page).getByText("Approved")).toBeVisible();
    expect(calls).toEqual([{ decision: "approve" }]);
  });

  test("Ask Reins to cancel opens chat with the request filled in", async ({ page }) => {
    await page.goto("/subscriptions");
    await page.getByRole("button", { name: /iQIYI/ }).first().click();
    await page.getByRole("link", { name: "Ask Reins to cancel" }).click();
    await expect(page).toHaveURL(/\/chat\?ask=/);
    await expect(page.getByLabel("Message")).toHaveValue("Cancel my iQIYI subscription");
  });
});

test.describe("sign in", () => {
  test("without sign in connected, the app opens and the login page says so", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("heading", { name: "Needs your OK" })).toBeVisible();

    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in is not set up" })).toBeVisible();
    await page.getByRole("link", { name: "Open Reins" }).click();
    await expect(page).toHaveURL("/");
  });
});

test.describe("pause everything", () => {
  test("a reload while paused still says paused, and resuming asks the server", async ({ page }) => {
    let enabled = true;
    const posts: unknown[] = [];
    await page.route("**/api/kill-switch", async (route) => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as { enabled: boolean };
        posts.push(body);
        enabled = body.enabled;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled, changedAt: null }) });
    });
    await page.goto("/");
    await expect(page.getByText("Everything is paused. No payments or cancellations will run.")).toBeVisible();

    await page.getByRole("button", { name: "Resume", exact: true }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Resume", exact: true }).click();
    await expect(page.getByText("Everything is paused.")).toBeHidden();
    expect(posts).toEqual([{ enabled: false }]);
  });
});
