// Read-only checks that the demo seed matches the code (run after `supabase db reset`).
// Skipped when DATABASE_URL is not set.

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPolicy } from "@/src/core/mandate/canonical";
import { parsePolicy } from "@/src/core/mandate/schema";
import { LIN_MANDATE_V3 } from "@/src/core/mandate/examples";
import { medianMadCheck } from "@/src/core/gate/anomaly";
import { DB_ENABLED, adminPool } from "./helpers";

const LIN = "11111111-1111-4111-8111-111111111111";

describe.skipIf(!DB_ENABLED)("foundations: demo seed", () => {
  let admin: Pool;
  beforeAll(() => {
    admin = adminPool();
  });
  afterAll(() => admin.end());

  it("Lin's active mandate v3 is the PRD §9.3 policy with a matching hash", async () => {
    const r = await admin.query("select version, policy_json, policy_hash from public.mandates where user_id = $1 and status = 'active'", [LIN]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].version).toBe(3);
    expect(parsePolicy(r.rows[0].policy_json).ok).toBe(true);
    expect(r.rows[0].policy_hash).toBe(hashPolicy(LIN_MANDATE_V3));
    expect(hashPolicy(r.rows[0].policy_json)).toBe(r.rows[0].policy_hash);
  });

  it("the current electricity bill is anomalous against six months of history", async () => {
    const r = await admin.query(
      "select amount::int as amount, status from public.bills where user_id = $1 and biller_id = 'SZ_POWER' order by due_date",
      [LIN],
    );
    const paid = r.rows.filter((b) => b.status === "paid").map((b) => b.amount);
    const current = r.rows.find((b) => b.status === "unpaid");
    expect(paid).toHaveLength(6);
    expect(current.amount).toBe(612);
    expect(medianMadCheck(current.amount, paid, 3, 3).anomalous).toBe(true);
  });

  it("the mock bank mirrors Lin's bills, subscriptions and escrow plan", async () => {
    const pub = await admin.query("select id, amount::int as amount, status from public.bills where user_id = $1 order by id", [LIN]);
    const mb = await admin.query("select id, amount::int as amount, status from mockbank.bills where customer_id = $1 order by id", [LIN]);
    expect(mb.rows).toEqual(pub.rows);
    const subs = await admin.query("select count(*)::int as n from mockbank.subscriptions where customer_id = $1", [LIN]);
    expect(subs.rows[0].n).toBe(4);
    const trial = await admin.query(
      "select trial_status_origin, keep_flag from public.subscriptions where user_id = $1 and status = 'trial'",
      [LIN],
    );
    expect(trial.rows[0]).toEqual({ trial_status_origin: "mock_bank", keep_flag: false });
    const plan = await admin.query("select units_redeemed, status from mockbank.escrow_plans where chain_plan_id = 1");
    expect(plan.rows[0]).toEqual({ units_redeemed: 12, status: "active" });
  });
});
