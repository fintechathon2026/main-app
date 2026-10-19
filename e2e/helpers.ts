// Shared helpers for the Playwright E2E suite (task.md R4-10).
// The server runs with REINS_FIXTURES=1, so read routes return synthetic Lin data. The agent
// itself (LangGraph, Gate, executor) is covered by the Vitest e2e suite against a real database
// (tests/e2e/*.test.ts); here the chat stream is stubbed at the network boundary so the UI can
// be checked deterministically: what it renders, and that it never invents an approval card.

import type { Page } from "@playwright/test";
import type { ChatStreamEvent } from "@/src/server/api-types";

/** Fulfils POST /api/chat with the given NDJSON events and records the request bodies. */
export async function stubChat(page: Page, events: ChatStreamEvent[]): Promise<{ bodies: unknown[] }> {
  const bodies: unknown[] = [];
  await page.route("**/api/chat", async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    });
  });
  return { bodies };
}

/** Stubs the bill upload so a "document" can be attached without the ingest pipeline. */
export async function stubUpload(page: Page, documentId: string): Promise<void> {
  await page.route("**/api/ingest/upload", (route) => route.fulfill({ json: { documentId } }));
}

/** Records approval decisions and answers like the real route would after a resume. */
export async function stubDecision(page: Page, feed: string[]): Promise<{ decisions: { id: string; body: unknown }[] }> {
  const decisions: { id: string; body: unknown }[] = [];
  await page.route(/\/api\/approvals\/[0-9a-f-]{36}$/, async (route) => {
    const id = route.request().url().split("/").pop() ?? "";
    const body = route.request().postDataJSON() as { decision: "approve" | "reject" };
    decisions.push({ id, body });
    await route.fulfill({
      json: {
        approvalId: id,
        status: body.decision === "approve" ? "approved" : "rejected",
        planId: "91000000-0000-4000-8000-000000000001",
        resume: { planId: "91000000-0000-4000-8000-000000000001", status: "done", feed },
      },
    });
  });
  return { decisions };
}

/** A minimal one-page PDF; contents do not matter because the upload is stubbed. */
export const TINY_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);
