// public.plans lifecycle against Postgres (architecture §11.2): one running plan per
// (user, trigger, subject), except chat, where every message is its own plan; paused plans
// whose approvals expired give their key back (lazily on create, and via cron/cleanup).
// Skipped without DATABASE_URL.

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pgPlanRegistry } from "@/src/agent/run";
import { getPool, setPool } from "@/src/server/db/pool";
import { DB_ENABLED, adminPool, createTestUser } from "../foundations/helpers";

vi.mock("next/server", () => ({ connection: async () => {} }));

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

describe.skipIf(!DB_ENABLED)("plans: paused plans whose approvals expired", () => {
  let admin: Pool;

  beforeAll(() => {
    admin = adminPool();
  });

  afterAll(async () => {
    await admin.end();
    await getPool().end();
    setPool(null);
  });

  /** A paused due_date plan with one action awaiting an approval that expires at `expiresAt`. */
  async function pausedPlan(userId: string, subjectId: string, expiresAt: string) {
    const planId = await pgPlanRegistry.create({ userId, trigger: "due_date", subjectId });
    await pgPlanRegistry.setStatus(planId, userId, "paused");
    const a = await admin.query(
      `insert into public.actions (plan_id, user_id, idx, tool, args_json, args_hash, mandate_version, idempotency_key, status)
       values ($1, $2, 0, 'pay_bill', '{}', repeat('a', 64), 3, gen_random_uuid()::text, 'awaiting_approval') returning id`,
      [planId, userId],
    );
    const ap = await admin.query(
      `insert into public.approvals (user_id, action_id, action_hash, mandate_version, expires_at)
       values ($1, $2, repeat('a', 64), 3, $3::timestamptz) returning id`,
      [userId, a.rows[0].id, expiresAt],
    );
    return { planId, actionId: a.rows[0].id as string, approvalId: ap.rows[0].id as string };
  }

  const status = async (table: string, id: string) => (await admin.query(`select status from public.${table} where id = $1`, [id])).rows[0].status;

  it("a new plan for the same key closes a paused plan whose approval expired", async () => {
    const u = await createTestUser(admin, [{ biller: "SZ_POWER", amount: 200, key: "b" }]);
    const old = await pausedPlan(u.id, u.bills.b, new Date(Date.now() - 60_000).toISOString());

    const fresh = await pgPlanRegistry.create({ userId: u.id, trigger: "due_date", subjectId: u.bills.b });
    expect(fresh).not.toBe(old.planId);
    expect(await status("plans", old.planId)).toBe("done");
    expect(await status("approvals", old.approvalId)).toBe("expired");
    expect(await status("actions", old.actionId)).toBe("expired");
  });

  it("a paused plan with a live approval still holds its key", async () => {
    const u = await createTestUser(admin, [{ biller: "SZ_POWER", amount: 200, key: "b" }]);
    const old = await pausedPlan(u.id, u.bills.b, new Date(Date.now() + 600_000).toISOString());
    await expect(pgPlanRegistry.create({ userId: u.id, trigger: "due_date", subjectId: u.bills.b })).rejects.toThrow(/one_running_plan/);
    expect(await status("plans", old.planId)).toBe("paused");
  });

  it("cron/cleanup closes expired paused plans for the configured users, behind CRON_SECRET", async () => {
    const u = await createTestUser(admin, [{ biller: "SZ_POWER", amount: 200, key: "b" }]);
    const old = await pausedPlan(u.id, u.bills.b, new Date(Date.now() - 60_000).toISOString());
    const saved = { secret: process.env.CRON_SECRET, users: process.env.REINS_CRON_USER_IDS };
    process.env.CRON_SECRET = "cleanup-secret-for-tests";
    process.env.REINS_CRON_USER_IDS = u.id;
    try {
      const { GET } = await import("@/app/api/cron/cleanup/route");
      const req = (auth?: string) => new Request("http://localhost/api/cron/cleanup", { headers: auth ? { authorization: auth } : {} });
      expect((await GET(req())).status).toBe(401);
      expect((await GET(req("Bearer wrong-secret-of-length"))).status).toBe(401);
      expect(await status("plans", old.planId)).toBe("paused");

      const res = await GET(req("Bearer cleanup-secret-for-tests"));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, results: [{ userId: u.id, closedPlans: 1 }] });
      expect(await status("plans", old.planId)).toBe("done");
    } finally {
      process.env.CRON_SECRET = saved.secret;
      process.env.REINS_CRON_USER_IDS = saved.users;
    }
  });
});

describe.skipIf(!DB_ENABLED)("documents: processing status", () => {
  let admin: Pool;

  beforeAll(() => {
    admin = adminPool();
  });

  afterAll(async () => {
    await admin.end();
    await getPool().end();
    setPool(null);
  });

  it("setStatus records the reader outcome on the user's own document", async () => {
    const { createPgDocumentRepo } = await import("@/src/server/ingest/repo");
    const u = await createTestUser(admin, []);
    const repo = createPgDocumentRepo();
    const { id } = await repo.insertIdempotent({
      userId: u.id,
      type: "bill_pdf",
      storageRef: "local:test",
      sha256: `status-${u.id}`,
      receivedAt: new Date(),
      retentionUntil: new Date(Date.now() + 86_400_000),
    });
    await repo.setStatus(id, u.id, "needs_review");
    const r = await admin.query("select status from public.documents where id = $1", [id]);
    expect(r.rows[0].status).toBe("needs_review");
  });
});
