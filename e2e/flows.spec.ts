// The five R0 demo flows (task.md R4-10, §9 shot list), at the UI layer. See ./helpers.ts for
// what is real (fixture-backed routes, mandate editor, kill switch) and what is stubbed (the
// agent stream, approval decisions).

import { expect, test } from "@playwright/test";
import { TINY_PDF, stubChat, stubDecision, stubUpload } from "./helpers";

const BILL_APPROVAL_ID = "a9000000-0000-4000-8000-000000000001";
const EXIT_APPROVAL_ID = "a9000000-0000-4000-8000-000000000002";
const PLAN_ID = "91000000-0000-4000-8000-000000000001";

test.describe("1. bill with approval", () => {
  test("an unusual bill asks first, shows the exact action, and pays once on approve", async ({ page }) => {
    await stubChat(page, [
      { type: "plan", planId: PLAN_ID },
      { type: "status", node: "gate_preview" },
      { type: "token", text: "Your electricity bill is ¥486, well above your usual amount, so I need your approval." },
      { type: "approval_required", planId: PLAN_ID, approvalId: BILL_APPROVAL_ID },
      { type: "done", planId: PLAN_ID, route: "approve" },
    ]);
    const { decisions } = await stubDecision(page, ["Paid State Grid Shenzhen ¥486 with your approval (mandate v3)."]);

    await page.goto("/chat");
    await page.getByRole("button", { name: "Pay my electricity bill" }).click();

    // The card comes from /api/approvals, not from the streamed text.
    const card = page.locator("section").filter({ hasText: "State Grid Shenzhen" }).filter({ has: page.getByRole("button", { name: "Approve" }) });
    await expect(card).toBeVisible();
    await expect(card).toContainText("¥486");
    await expect(card).toContainText("registered payee");
    await expect(card).toContainText("§bills.anomaly");
    await expect(card).toContainText("once.");

    await card.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Paid State Grid Shenzhen ¥486")).toBeVisible();
    expect(decisions).toEqual([{ id: BILL_APPROVAL_ID, body: { decision: "approve" } }]);
  });

  test("the approvals inbox lists the same card and badges the count", async ({ page, isMobile }) => {
    await page.goto("/approvals");
    await expect(page.getByRole("heading", { name: "Approvals" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(2);
    // The count sits in the sidebar on desktop and as a dot in the bottom bar on mobile.
    await expect(page.getByRole(isMobile ? "navigation" : "complementary").getByLabel("2 waiting")).toBeVisible();
  });
});

test.describe("2. attack PDF blocked", () => {
  test("a bill PDF is marked untrusted, the injected payment is blocked, and Why? shows the rule", async ({ page }) => {
    await stubUpload(page, "d0000000-0000-4000-8000-000000000099");
    const { bodies } = await stubChat(page, [
      { type: "plan", planId: PLAN_ID },
      { type: "status", node: "reader" },
      { type: "feed", text: "Blocked: pay State Grid Shenzhen. The amount does not match the bill on record." },
      { type: "done", planId: PLAN_ID, route: "deny" },
    ]);

    await page.goto("/chat");
    await page.getByLabel("Attach a bill PDF").setInputFiles({ name: "electricity-attack.pdf", mimeType: "application/pdf", buffer: TINY_PDF });
    await expect(page.getByText("untrusted document")).toBeVisible();
    await page.getByPlaceholder("What should Reins do with this bill?").fill("Pay this bill");
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByText("Blocked: pay State Grid Shenzhen.")).toBeVisible();
    // The document reaches the agent only as an id, never as text the planner could obey.
    expect(bodies).toEqual([{ message: "Pay this bill", documentIds: ["d0000000-0000-4000-8000-000000000099"] }]);
    // No approval card is shown for a denied action.
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);

    await page.goto("/activity");
    const blocked = page.locator("li").filter({ hasText: "Blocked: pay State Grid Shenzhen" });
    await expect(blocked).toContainText("The amount does not match the bill on record.");
    await blocked.getByRole("button", { name: "Why?" }).click();
    await expect(page.getByText("Why this happened")).toBeVisible();
    await expect(page.getByText("§provenance.amount")).toBeVisible();
    await expect(page.getByText("Audit log (hash-chained)")).toBeVisible();
  });
});

test.describe("3. cancel", () => {
  test("a recommendation links to chat with a prefilled request, and a cancel needs approval", async ({ page }) => {
    const { bodies } = await stubChat(page, [
      { type: "plan", planId: PLAN_ID },
      { type: "token", text: "Cancelling needs your approval under your mandate." },
      { type: "feed", text: "Waiting for your approval to cancel iQIYI." },
      { type: "done", planId: PLAN_ID, route: "approve" },
    ]);

    await page.goto("/subscriptions");
    const rec = page.locator("li").filter({ hasText: "Consider cancelling iQIYI" });
    await expect(rec).toContainText("save");
    await rec.getByRole("link", { name: "Ask Reins to cancel" }).click();

    await expect(page).toHaveURL(/\/chat\?prompt=/);
    const box = page.getByPlaceholder("Message Reins…");
    await expect(box).toHaveValue("Cancel my iQIYI subscription");
    // Prefill only: nothing is sent until the user presses Send.
    expect(bodies).toEqual([]);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Waiting for your approval to cancel iQIYI.")).toBeVisible();
    expect(bodies).toEqual([{ message: "Cancel my iQIYI subscription" }]);
  });

  test("a trial can be kept so it is not auto-cancelled", async ({ page }) => {
    await page.route("**/api/subscriptions/*/keep", (route) => route.fulfill({ json: { subscriptionId: "x", keepFlag: true } }));
    await page.goto("/subscriptions");
    const trial = page.locator("li").filter({ hasText: "Trial ends" }).first();
    await expect(trial).toContainText("unless you keep it");
    const keepCall = page.waitForRequest((r) => r.url().includes("/keep") && r.method() === "POST");
    await trial.getByRole("button", { name: "Keep it" }).click();
    await keepCall;
  });
});

test.describe("4. mandate edit", () => {
  test("unchanged rules cannot be signed; narrowing signs; widening needs an explicit confirmation", async ({ page }) => {
    // Version-relative, so it holds whichever project runs first against the shared fixture state.
    await page.goto("/mandate");
    const startVersion = Number((await page.getByText(/^Mandate card · v\d+$/).textContent())?.match(/\d+/)?.[0]);
    expect(startVersion).toBeGreaterThan(0);

    // Unchanged: no change, cannot sign.
    await page.getByRole("button", { name: "Edit rules" }).click();
    await page.getByRole("button", { name: "Review changes" }).click();
    await expect(page.getByText(`Nothing changed against v${startVersion}.`)).toBeVisible();
    await expect(page.getByRole("button", { name: `Sign v${startVersion + 1}` })).toBeDisabled();

    // Narrowing: lower the auto-pay cap.
    const autoPay = page.getByLabel("Pay bills automatically up to (CNY)");
    const current = Number(await autoPay.inputValue());
    await autoPay.fill(String(Math.max(0, current - 50)));
    await expect(page.getByRole("button", { name: `Sign v${startVersion + 1}` })).toHaveCount(0); // edit cleared the review
    await page.getByRole("button", { name: "Review changes" }).click();
    await expect(page.getByText("Narrowing: Reins gets less room")).toBeVisible();
    await expect(page.getByText(/Changes against v\d+/).locator("..")).toContainText("bills.auto_pay_max");
    await page.getByRole("button", { name: `Sign v${startVersion + 1}` }).click();
    await expect(page.getByText(`Mandate v${startVersion + 1} is active (1 change).`)).toBeVisible();
    await expect(page.getByText(`Mandate card · v${startVersion + 1}`)).toBeVisible();

    // Widening: raise the daily cap.
    await page.getByRole("button", { name: "Edit rules" }).click();
    const cap = page.getByLabel("Total payments per day at most (CNY)");
    await cap.fill(String(Number(await cap.inputValue()) + 1000));
    await page.getByRole("button", { name: "Review changes" }).click();
    await expect(page.getByText("Widening: Reins gets more room")).toBeVisible();
    const sign = page.getByRole("button", { name: `Sign v${startVersion + 2}` });
    await expect(sign).toBeDisabled();
    await page.getByLabel("I understand this gives Reins more room to act without asking me.").check();
    await sign.click();
    await expect(page.getByText(`Mandate v${startVersion + 2} is active (1 change).`)).toBeVisible();

    // History shows both changes with their class.
    const history = page.locator("section").filter({ hasText: "Version history" });
    await expect(history).toContainText("global.daily_outflow_cap");
    await expect(history).toContainText("widening");
    await expect(history).toContainText("narrowing");
  });
});

test.describe("5. prepaid", () => {
  test("plan shows escrow and test-token tag; the advisor gives the break-even", async ({ page }) => {
    await page.goto("/prepaid");
    const plan = page.locator("section.rounded-2xl").filter({ hasText: "Sessions left" });
    await expect(plan).toContainText("48 / 60");
    await expect(plan).toContainText("¥4,800");
    await expect(plan).toContainText("Test token, no value");
    await expect(plan.getByRole("link", { name: /tx 0x/ })).toHaveAttribute("href", /basescan\.org\/tx\/0x/);

    const offer = page.locator("section.rounded-2xl").filter({ hasText: "Escrow protected" });
    await offer.getByRole("button", { name: "Should I buy this?" }).click();
    await expect(offer).toContainText("48 sessions");
    await expect(offer).toContainText("¥1,500");
  });

  test("an attested exit waits for approval and shows the refund going back to the owner", async ({ page }) => {
    const { decisions } = await stubDecision(page, ["Exited plan with FitBox Futian, refund ¥4,800 sent to you."]);
    await page.goto("/approvals");
    const card = page.locator("section").filter({ hasText: "FitBox Futian" }).filter({ has: page.getByRole("button", { name: "Approve" }) });
    await expect(card).toContainText("Cannot be undone");
    await expect(card).toContainText("back to you");
    await card.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("refund ¥4,800 sent to you")).toBeVisible();
    expect(decisions).toEqual([{ id: EXIT_APPROVAL_ID, body: { decision: "approve" } }]);
  });

  test.fixme("buy with escrow → check in → exit, signed in the browser (R4-07, R4-09 not built)", async () => {});
});

test.describe("evidence and kill switch", () => {
  test("the audit chain verifies, hashes link to Basescan, and the kill switch toggles", async ({ page }) => {
    await page.goto("/evidence");
    await expect(page.getByText("✓ Verified")).toBeVisible();
    await expect(page.getByRole("link", { name: /tx 0x/ }).first()).toHaveAttribute("href", /sepolia\.basescan\.org\/tx\//);

    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Stop all actions" }).click();
    await expect(page.getByText("Reins cannot pay, cancel or move prepaid money.")).toBeVisible();
    await page.getByRole("button", { name: "Turn off" }).click();
    await expect(page.getByText("Reins acts inside your mandate as usual.")).toBeVisible();
  });

  test("audit export downloads JSONL", async ({ page }) => {
    await page.goto("/evidence");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export JSONL" }).click();
    expect((await download).suggestedFilename()).toBe("reins-audit.jsonl");
  });
});
