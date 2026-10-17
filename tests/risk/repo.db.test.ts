// Read-only checks of the Postgres RiskRepo against the local demo seed. Skipped when
// DATABASE_URL is not set. Writes nothing (another suite owns the local database).

import { afterAll, describe, expect, it } from "vitest";
import { setPool } from "@/src/server/db/pool";
import { createPgRiskRepo } from "@/src/server/risk/repo";
import { SIM_MERCHANTS } from "@/src/sim/registry/merchants";
import { USER } from "./helpers";

describe.skipIf(!process.env.DATABASE_URL)("risk repo (read-only, seeded DB)", () => {
  const repo = createPgRiskRepo();
  const saved = process.env.REINS_RISK_USER_IDS;

  afterAll(async () => {
    process.env.REINS_RISK_USER_IDS = saved;
    setPool(null);
  });

  it("the registry simulator's merchant addresses match prepaid_merchants", async () => {
    const rows = await repo.getMerchants(SIM_MERCHANTS.map((m) => m.id));
    for (const m of SIM_MERCHANTS) {
      const row = rows.find((r) => r.id === m.id);
      expect(row, m.id).toBeDefined();
      expect(row!.chainAddress.toLowerCase()).toBe(m.address.toLowerCase());
    }
  });

  it("reads Lin's prepaid mandate facts", async () => {
    expect(await repo.prepaidPolicy(USER)).toEqual({ attestationMaxAgeDays: 2, warnOnSoftSignals: true });
  });

  it("lists active plans (system function, or the REINS_RISK_USER_IDS fallback)", async () => {
    process.env.REINS_RISK_USER_IDS = USER;
    const plans = await repo.listActivePlans();
    for (const p of plans) expect(typeof p.merchantId).toBe("string");
    expect(plans.filter((p) => p.userId === USER).every((p) => /^[0-9a-f-]{36}$/.test(p.planId))).toBe(true);
  });
});
