// public.plans lifecycle against Postgres (architecture §11.2): one running plan per
// (user, trigger, subject), except chat, where every message is its own plan.
// Skipped without DATABASE_URL.

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgPlanRegistry } from "@/src/agent/run";
import { getPool, setPool } from "@/src/server/db/pool";
import { DB_ENABLED, adminPool, createTestUser } from "../foundations/helpers";

describe.skipIf(!DB_ENABLED)("plans: one running plan per key", () => {
  let admin: Pool;

  beforeAll(() => {
    admin = adminPool();
  });

  afterAll(async () => {
    await admin.end();
    await getPool().end();
    setPool(null);
  });

  it("a paused chat plan does not block the next chat message", async () => {
    const u = await createTestUser(admin, []);
    const first = await pgPlanRegistry.create({ userId: u.id, trigger: "chat", subjectId: null });
    await pgPlanRegistry.setStatus(first, u.id, "paused");
    const second = await pgPlanRegistry.create({ userId: u.id, trigger: "chat", subjectId: null });
    expect(second).not.toBe(first);
  });

  it("still allows only one running plan per subject for other triggers", async () => {
    const u = await createTestUser(admin, [{ biller: "SZ_POWER", amount: 200, key: "b" }]);
    await pgPlanRegistry.create({ userId: u.id, trigger: "due_date", subjectId: u.bills.b });
    await expect(pgPlanRegistry.create({ userId: u.id, trigger: "due_date", subjectId: u.bills.b })).rejects.toThrow(/one_running_plan/);
  });
});
