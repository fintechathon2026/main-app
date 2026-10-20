// Owner: R2 (roles.md). Pure tests for the Mandate Card builders. No database needed.

import { describe, expect, it } from "vitest";
import { hashPolicy } from "@/src/core/mandate/canonical";
import { LIN_MANDATE_V3 } from "@/src/core/mandate/examples";
import { MandateRowError, buildActive, buildHistory, describeChange } from "@/src/server/db/read/mandate-view";
import { LIN_MANDATE_ROWS } from "./seed";

const v3 = LIN_MANDATE_ROWS[2]!;

describe("buildActive", () => {
  it("returns the stored hash and the policy with every default applied", () => {
    const a = buildActive(v3);
    expect(a).toMatchObject({ version: 3, hash: v3.policyHash, createdVia: "nl", signedAt: "2026-10-12T06:20:00.000Z" });
    expect(a.policy.global.daily_outflow_cap).toBe(1000);
    expect(a.policy.payees.allow).toEqual(["SZ_POWER", "CHINA_MOBILE", "LANDLORD_WANG"]);
  });

  it("refuses a row whose stored hash does not match its policy", () => {
    expect(() => buildActive({ ...v3, policyHash: "0".repeat(64) })).toThrow(MandateRowError);
    const edited = { ...LIN_MANDATE_V3, global: { daily_outflow_cap: 999999 } };
    expect(() => buildActive({ ...v3, policyJson: edited })).toThrow(/hash/);
  });

  it("refuses a policy that fails the strict schema even if its hash matches", () => {
    const bad = { ...LIN_MANDATE_V3, surprise: true };
    // hash recomputed so only the schema check can fail
    expect(() => buildActive({ ...v3, policyJson: bad, policyHash: hashPolicy(bad) })).toThrow(/not valid/);
  });
});

describe("buildHistory", () => {
  it("lists versions newest first with one sentence each", () => {
    const h = buildHistory(LIN_MANDATE_ROWS);
    expect(h.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(h.map((v) => v.change)).toEqual([
      "Added rules for prepaid packages",
      "Auto-pay limit lowered from ¥500 to ¥300",
      "First rules signed",
    ]);
    expect(h.map((v) => v.status)).toEqual(["active", "superseded", "superseded"]);
  });

  it("classifies only the first version until compareMandates is wired in", () => {
    expect(buildHistory(LIN_MANDATE_ROWS).map((v) => v.direction)).toEqual([null, null, "first"]);
  });

  it("fails on any row whose stored hash does not match its policy, like the active card", () => {
    const tampered = LIN_MANDATE_ROWS.map((r) => (r.version === 2 ? { ...r, policyJson: { ...(r.policyJson as object), global: { daily_outflow_cap: 99999 } } } : r));
    expect(() => buildHistory(tampered)).toThrow(MandateRowError);
    expect(() => buildHistory([{ ...LIN_MANDATE_ROWS[0]!, policyHash: "0".repeat(64) }])).toThrow(/hash/);
  });

  it("does not depend on row order", () => {
    expect(buildHistory([...LIN_MANDATE_ROWS].reverse())).toEqual(buildHistory(LIN_MANDATE_ROWS));
  });
});

describe("describeChange", () => {
  const base = { ...LIN_MANDATE_V3 };
  it("says so when nothing but the version changed", () => {
    expect(describeChange(base, { ...base, version: 4 })).toBe("Rules signed again with no changes");
  });

  it("summarises many changes with the first two and a count", () => {
    const next = { ...base, version: 4, bills: { ...base.bills, auto_pay_max: 100 }, global: { daily_outflow_cap: 500 }, payees: { allow: ["SZ_POWER"], new_payee: "confirm" } };
    const s = describeChange(base, next);
    expect(s).toContain("Daily limit lowered from ¥1,000 to ¥500");
    expect(s).toMatch(/and 2 more$/);
  });

  it("uses the rupiah symbol for IDR and falls back to the field name for unknown fields", () => {
    const idr = { ...base, base_currency: "IDR" };
    expect(describeChange(idr, { ...idr, bills: { ...base.bills, auto_pay_max: 1000 } })).toBe("Auto-pay limit raised from Rp 300 to Rp 1,000");
    expect(describeChange(base, { ...base, bills: { ...base.bills, pay_days_before_due: 5 } })).toBe("Changed bills: pay days before due");
  });
});
