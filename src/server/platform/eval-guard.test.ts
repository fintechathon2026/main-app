import { describe, expect, it } from "vitest";
import { assertGateNotDisabled, evalGateDisabledAllowed } from "./eval-guard";

describe("evalGateDisabledAllowed (arm A switch)", () => {
  it("is false without the flag, whatever the environment", () => {
    expect(evalGateDisabledAllowed({})).toBe(false);
    expect(evalGateDisabledAllowed({ NODE_ENV: "test", REINS_EVAL_DISABLE_GATE: "" })).toBe(false);
    expect(evalGateDisabledAllowed({ NODE_ENV: "test", REINS_EVAL_DISABLE_GATE: "off" })).toBe(false);
  });

  it("is true with the flag outside a deployed environment", () => {
    expect(evalGateDisabledAllowed({ NODE_ENV: "test", REINS_EVAL_DISABLE_GATE: "1" })).toBe(true);
    expect(evalGateDisabledAllowed({ REINS_EVAL_DISABLE_GATE: "true" })).toBe(true);
  });

  it("is false with the flag in production or on Vercel", () => {
    expect(evalGateDisabledAllowed({ NODE_ENV: "production", REINS_EVAL_DISABLE_GATE: "1" })).toBe(false);
    expect(evalGateDisabledAllowed({ NODE_ENV: "test", VERCEL_ENV: "preview", REINS_EVAL_DISABLE_GATE: "1" })).toBe(false);
  });
});

describe("assertGateNotDisabled (I-04)", () => {
  it("passes when the flag is unset or empty", () => {
    expect(() => assertGateNotDisabled({ NODE_ENV: "production" })).not.toThrow();
    expect(() => assertGateNotDisabled({ NODE_ENV: "production", REINS_EVAL_DISABLE_GATE: "" })).not.toThrow();
    expect(() => assertGateNotDisabled({ VERCEL_ENV: "production", REINS_EVAL_DISABLE_GATE: "0" })).not.toThrow();
  });

  it("allows the flag outside production (test, development, no env)", () => {
    expect(() => assertGateNotDisabled({ NODE_ENV: "test", REINS_EVAL_DISABLE_GATE: "1" })).not.toThrow();
    expect(() => assertGateNotDisabled({ NODE_ENV: "development", REINS_EVAL_DISABLE_GATE: "1" })).not.toThrow();
    expect(() => assertGateNotDisabled({ REINS_EVAL_DISABLE_GATE: "1" })).not.toThrow();
  });

  it("throws when the flag is set with NODE_ENV=production", () => {
    expect(() => assertGateNotDisabled({ NODE_ENV: "production", REINS_EVAL_DISABLE_GATE: "1" })).toThrow(/REINS_EVAL_DISABLE_GATE/);
    expect(() => assertGateNotDisabled({ NODE_ENV: "production", REINS_EVAL_DISABLE_GATE: "true" })).toThrow();
  });

  it("throws when the flag is set with VERCEL_ENV set", () => {
    expect(() => assertGateNotDisabled({ NODE_ENV: "test", VERCEL_ENV: "preview", REINS_EVAL_DISABLE_GATE: "1" })).toThrow(/VERCEL_ENV=preview/);
    expect(() => assertGateNotDisabled({ VERCEL_ENV: "development", REINS_EVAL_DISABLE_GATE: "yes" })).toThrow();
  });
});
