// claimExitTrigger / releaseExitTrigger on Postgres: a released claim can be taken again, an
// unreleased one cannot. Uses a fresh test user (audit log only). Skipped without DATABASE_URL.

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPool, setPool } from "@/src/server/db/pool";
import { createPgRiskRepo } from "@/src/server/risk/repo";
import { DB_ENABLED, adminPool, createTestUser } from "../foundations/helpers";

describe.skipIf(!DB_ENABLED)("risk repo: exit trigger claims", () => {
  let admin: Pool;
  const repo = createPgRiskRepo();

  beforeAll(() => {
    admin = adminPool();
  });

  afterAll(async () => {
    await admin.end();
    await getPool().end();
    setPool(null);
  });

  it("claims once, and again only after a release", async () => {
    const u = await createTestUser(admin, []);
    const claim = { userId: u.id, prepaidPlanId: randomUUID(), attestationId: randomUUID(), merchantId: "FITBOX_FUTIAN", kind: "court_enforcement", simulated: true };
    expect(await repo.claimExitTrigger(claim)).toBe(true);
    expect(await repo.claimExitTrigger(claim)).toBe(false);
    await repo.releaseExitTrigger({ ...claim, reason: "plan_not_created" });
    expect(await repo.claimExitTrigger(claim)).toBe(true);
    expect(await repo.claimExitTrigger(claim)).toBe(false);
  });
});
