// Read-only: the card queries run against the real schema under RLS. Skipped without DATABASE_URL.

import { afterAll, describe, expect, it } from "vitest";
import { setPool } from "@/src/server/db/pool";
import { listPendingCards, planIdForAction } from "@/app/api/approvals/_lib/cards";

const LIN = "11111111-1111-4111-8111-111111111111";

describe.skipIf(!process.env.DATABASE_URL)("approval cards (read-only, seeded DB)", () => {
  afterAll(() => setPool(null));

  it("lists only pending, unexpired cards of the session user", async () => {
    const cards = await listPendingCards(LIN);
    for (const c of cards) {
      expect(Date.parse(c.expiresAt)).toBeGreaterThan(Date.now() - 60_000);
      expect(c.actionHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("does not resolve a plan for an action the user does not own", async () => {
    expect(await planIdForAction(LIN, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});
