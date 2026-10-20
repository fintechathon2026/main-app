import { describe, expect, it } from "vitest";
import type { GateSnapshot, Origin, PrepaidFacts, TypedAction } from "../types";
import { LIN_MANDATE_V3 } from "../mandate/examples";
import { decide } from "./decide";
import { medianMadCheck } from "./anomaly";
import { PREPAID_RULE_IDS } from "./rule-ids";

const NOW = "2026-10-17T08:00:00.000Z";
const OWNER = "0x1111111111111111111111111111111111111111";
const MERCHANT = "0x2222222222222222222222222222222222222222";
const AGENT = "0x3333333333333333333333333333333333333333";

type Patch = { [K in keyof GateSnapshot]?: GateSnapshot[K] };
type PolicyPatch = (p: Record<string, unknown>) => void;

function clonePolicy(patch?: PolicyPatch) {
  const p = JSON.parse(JSON.stringify(LIN_MANDATE_V3));
  patch?.(p);
  return p;
}

function snap(over: Patch = {}, policyPatch?: PolicyPatch): GateSnapshot {
  return {
    now: NOW,
    killSwitch: false,
    mandate: { version: 3, hash: "h3", policy: clonePolicy(policyPatch), signatureValid: true },
    provenance: { destinationOrigin: "registry", amountOrigin: "mock_bank", amountMatchesBill: true },
    payee: { billerId: "CHINA_MOBILE", inRegistry: true, verified: true },
    history: { amounts: [98, 98, 98, 98, 98] },
    fx: null,
    caps: { dailyUsed: 0, dailyCap: 1000 },
    approval: null,
    ...over,
  };
}

const pay = (amount = 98, billerId = "CHINA_MOBILE"): TypedAction => ({
  tool: "pay_bill",
  actor: "agent",
  args: { bill_id: "bill-1", biller_id: billerId, amount },
});
const cancel: TypedAction = { tool: "cancel_subscription", actor: "agent", args: { subscription_id: "sub-1" } };

const electricity = { payee: { billerId: "SZ_POWER", inRegistry: true, verified: true }, history: { amounts: [196, 214, 238, 205, 251, 222] } };

describe("decide: pipeline basics", () => {
  it("allows a normal small bill from mock_bank", () => {
    const r = decide(pay(), snap());
    expect(r.decision).toBe("allow");
    expect(r.mandateVersion).toBe(3);
    expect(r.amountBase).toBe(98);
    expect(r.trace.map((x) => x.ruleId)).toEqual(
      expect.arrayContaining(["global.kill_switch", "mandate.valid", "schema.pay_bill", "bills.anomaly", "global.daily_outflow_cap"]),
    );
  });

  it.each([
    ["kill switch on", snap({ killSwitch: true }), "global.kill_switch"],
    ["no mandate", snap({ mandate: null }), "mandate.valid"],
    ["bad signature", snap({ mandate: { version: 3, hash: "h", policy: LIN_MANDATE_V3, signatureValid: false } }), "mandate.valid"],
    ["invalid policy", snap({ mandate: { version: 3, hash: "h", policy: { version: 3 }, signatureValid: true } }), "mandate.valid"],
    ["version mismatch", snap({ mandate: { version: 4, hash: "h", policy: LIN_MANDATE_V3, signatureValid: true } }), "mandate.valid"],
    [
      "expired mandate",
      snap({}, (p) => {
        (p.global as Record<string, unknown>).expires_at = "2026-10-16T00:00:00Z";
      }),
      "mandate.valid",
    ],
  ])("denies: %s", (_name, s, rule) => {
    const r = decide(pay(), s);
    expect(r.decision).toBe("deny");
    expect(r.ruleIds).toContain(rule);
  });

  it("kill switch short-circuits even a pre-approved action", () => {
    const r = decide(pay(), snap({ killSwitch: true, approval: { valid: true } }));
    expect(r.decision).toBe("deny");
  });

  it.each([
    ["extra account field", { bill_id: "b", biller_id: "CHINA_MOBILE", amount: 98, account: "8812" }],
    ["non-integer amount", { bill_id: "b", biller_id: "CHINA_MOBILE", amount: 98.5 }],
    ["negative amount", { bill_id: "b", biller_id: "CHINA_MOBILE", amount: -1 }],
    ["missing bill id", { biller_id: "CHINA_MOBILE", amount: 98 }],
  ])("schema denies %s", (_n, args) => {
    const r = decide({ tool: "pay_bill", actor: "agent", args } as unknown as TypedAction, snap());
    expect(r.decision).toBe("deny");
    expect(r.ruleIds).toEqual(["schema.pay_bill"]);
  });

  it("denies an agent action submitted as a user action", () => {
    const r = decide({ ...pay(), actor: "user" } as unknown as TypedAction, snap());
    expect(r.decision).toBe("deny");
  });
});

describe("decide: provenance matrix (PRD §10.3)", () => {
  const rows: { name: string; dest: Origin | null; amountOrigin: Origin | null; matches: boolean; amount?: number; expected: string; rule: string }[] = [
    { name: "registry + mock_bank", dest: "registry", amountOrigin: "mock_bank", matches: true, expected: "allow", rule: "provenance.amount" },
    { name: "registry + aggregator", dest: "registry", amountOrigin: "aggregator", matches: true, expected: "allow", rule: "provenance.amount" },
    { name: "destination from document", dest: "document", amountOrigin: "mock_bank", matches: true, expected: "deny", rule: "provenance.destination" },
    { name: "destination from email", dest: "email", amountOrigin: "mock_bank", matches: true, expected: "deny", rule: "provenance.destination" },
    { name: "destination unknown", dest: null, amountOrigin: "mock_bank", matches: true, expected: "deny", rule: "provenance.destination" },
    { name: "amount mismatch", dest: "registry", amountOrigin: "mock_bank", matches: false, expected: "deny", rule: "provenance.amount_mismatch" },
    { name: "document amount, small, normal", dest: "registry", amountOrigin: "document", matches: true, expected: "allow", rule: "provenance.amount" },
    { name: "email amount, small, normal", dest: "registry", amountOrigin: "email", matches: true, expected: "allow", rule: "provenance.amount" },
    { name: "document amount, anomalous", dest: "registry", amountOrigin: "document", matches: true, amount: 120, expected: "require_confirm", rule: "provenance.amount" },
    { name: "csv amount", dest: "registry", amountOrigin: "csv", matches: true, expected: "require_confirm", rule: "provenance.amount" },
    { name: "web amount", dest: "registry", amountOrigin: "web", matches: true, expected: "require_confirm", rule: "provenance.amount" },
    { name: "notification amount", dest: "registry", amountOrigin: "notification", matches: true, expected: "require_confirm", rule: "provenance.amount" },
    { name: "unknown amount origin", dest: "registry", amountOrigin: null, matches: true, expected: "require_confirm", rule: "provenance.amount" },
  ];
  it.each(rows)("$name → $expected", ({ dest, amountOrigin, matches, amount, expected, rule }) => {
    const r = decide(pay(amount ?? 98), snap({ provenance: { destinationOrigin: dest, amountOrigin, amountMatchesBill: matches } }));
    expect(r.decision).toBe(expected);
    expect(r.trace.find((x) => x.ruleId === rule)?.result).toBe(expected === "allow" ? "allow" : expected);
  });

  it("denies when the payee row is for a different biller than the args", () => {
    const r = decide(pay(98, "SZ_POWER"), snap());
    expect(r.decision).toBe("deny");
    expect(r.ruleIds).toContain("provenance.destination");
  });

  it("an approval never upgrades a provenance deny", () => {
    const r = decide(pay(), snap({ provenance: { destinationOrigin: "registry", amountOrigin: "mock_bank", amountMatchesBill: false }, approval: { valid: true } }));
    expect(r.decision).toBe("deny");
    expect(r.ruleIds).toContain("provenance.amount_mismatch");
  });
});

describe("decide: payees", () => {
  it("denies a payee outside the allowlist with new_payee deny", () => {
    const r = decide(pay(98, "KOS_X"), snap({ payee: { billerId: "KOS_X", inRegistry: true, verified: true } }));
    expect(r.decision).toBe("deny");
    expect(r.ruleIds).toContain("payees.new_payee");
  });
  it("confirms a payee outside the allowlist with new_payee confirm", () => {
    const r = decide(
      pay(98, "KOS_X"),
      snap({ payee: { billerId: "KOS_X", inRegistry: true, verified: true } }, (p) => {
        (p.payees as Record<string, unknown>).new_payee = "confirm";
      }),
    );
    expect(r.decision).toBe("require_confirm");
  });
  it("treats an unverified registry payee as new", () => {
    const r = decide(pay(), snap({ payee: { billerId: "CHINA_MOBILE", inRegistry: true, verified: false } }));
    expect(r.decision).toBe("deny");
  });
});

describe("decide: amount, FX, anomaly, caps, approval", () => {
  it("requires confirmation above auto_pay_max (rent)", () => {
    const r = decide(
      pay(4500, "LANDLORD_WANG"),
      snap({ payee: { billerId: "LANDLORD_WANG", inRegistry: true, verified: true }, history: { amounts: [4500, 4500, 4500] }, caps: { dailyUsed: 0, dailyCap: 10000 } }, (p) => {
        (p.global as Record<string, unknown>).daily_outflow_cap = 10000;
      }),
    );
    expect(r.decision).toBe("require_confirm");
    expect(r.ruleIds).toContain("bills.auto_pay_max");
  });

  it("flags the anomalous ¥612 electricity bill (and it exceeds auto_pay_max)", () => {
    const r = decide(pay(612, "SZ_POWER"), snap(electricity));
    expect(r.decision).toBe("require_confirm");
    expect(r.ruleIds).toEqual(expect.arrayContaining(["bills.anomaly", "bills.auto_pay_max"]));
  });

  it("allows a normal electricity bill", () => {
    expect(decide(pay(231, "SZ_POWER"), snap(electricity)).decision).toBe("allow");
  });

  it("confirms when history is shorter than min_history", () => {
    const r = decide(pay(), snap({ history: { amounts: [98, 98] } }));
    expect(r.decision).toBe("require_confirm");
    expect(r.ruleIds).toEqual(["bills.anomaly", "approval.valid"]);
  });

  it("upgrades require_confirm to allow with a valid approval", () => {
    const r = decide(pay(612, "SZ_POWER"), snap({ ...electricity, approval: { valid: true } }));
    expect(r.decision).toBe("allow");
    expect(r.ruleIds).toContain("approval.valid");
  });

  it("keeps require_confirm with an invalid approval", () => {
    const r = decide(pay(612, "SZ_POWER"), snap({ ...electricity, approval: { valid: false, reason: "expired" } }));
    expect(r.decision).toBe("require_confirm");
    expect(r.reasons).toContain("approval.expired");
  });

  it("denies over the daily cap even with an approval", () => {
    const r = decide(pay(612, "SZ_POWER"), snap({ ...electricity, caps: { dailyUsed: 500, dailyCap: 1000 }, approval: { valid: true } }));
    expect(r.decision).toBe("deny");
    expect(r.ruleIds).toEqual(["global.daily_outflow_cap"]);
  });

  it("uses the stricter of snapshot and policy caps", () => {
    expect(decide(pay(), snap({ caps: { dailyUsed: 950, dailyCap: 5000 } })).decision).toBe("deny");
  });

  it("enforces per-payee caps", () => {
    const r = decide(
      pay(),
      snap({ caps: { dailyUsed: 0, dailyCap: 1000, perPayeeUsed: 98 } }, (p) => {
        (p.global as Record<string, unknown>).per_payee_daily_cap = { CHINA_MOBILE: 150 };
      }),
    );
    expect(r.decision).toBe("deny");
    expect(r.ruleIds).toContain("global.per_payee_daily_cap");
  });

  it("converts foreign amounts with margin and checks caps on the converted value", () => {
    const r = decide(pay(20), snap({ fx: { rate: 7.1, date: "2026-10-16", source: "fx_provider" }, history: { amounts: [147, 147, 147] } }));
    expect(r.amountBase).toBe(Math.ceil(20 * 7.1 * 1.03));
    expect(r.trace.find((x) => x.ruleId === "fx.rate_fresh")?.result).toBe("allow");
  });

  it("compares a foreign bill with history in its own currency, not the converted amount", () => {
    const r = decide(pay(20), snap({ fx: { rate: 7.1, date: "2026-10-16", source: "fx_provider" }, history: { amounts: [20, 20, 20, 20, 20] } }));
    expect(r.trace.find((x) => x.ruleId === "bills.anomaly")?.result).toBe("allow");
    expect(r.amountBase).toBe(Math.ceil(20 * 7.1 * 1.03));
  });

  it("flags a foreign bill that is anomalous in its own currency", () => {
    const r = decide(pay(40), snap({ fx: { rate: 7.1, date: "2026-10-16", source: "fx_provider" }, history: { amounts: [20, 20, 20, 20, 20] } }));
    expect(r.trace.find((x) => x.ruleId === "bills.anomaly")?.result).toBe("require_confirm");
  });

  it("denies a stale FX rate", () => {
    const r = decide(pay(20), snap({ fx: { rate: 7.1, date: "2026-10-10", source: "fx_provider" }, history: { amounts: [147, 147, 147] } }));
    expect(r.decision).toBe("deny");
    expect(r.ruleIds).toContain("fx.rate_fresh");
  });
});

describe("medianMadCheck (PRD §15.2)", () => {
  it.each([
    [612, [196, 214, 238, 205, 251, 222], 3, 3, true],
    [231, [196, 214, 238, 205, 251, 222], 3, 3, false],
    [98, [98, 98, 98], 3, 3, false],
    [99, [98, 98, 98], 3, 3, true],
    [98, [98, 98], 3, 3, true],
  ])("x=%d history=%j k=%d min=%d → anomalous=%s", (x, h, k, min, expected) => {
    expect(medianMadCheck(x, h, k, min).anomalous).toBe(expected);
  });
});

describe("decide: subscriptions", () => {
  const trial = { status: "trial", isTrial: true, trialOrigin: "mock_bank" as Origin, keepFlag: false, noticeSent: true };
  it("auto-cancels a trusted trial when every condition holds (T3)", () => {
    const r = decide(cancel, snap({ subscription: trial }));
    expect(r.decision).toBe("allow");
    expect(r.ruleIds).toContain("subscriptions.auto_cancel_trials");
  });
  it.each([
    ["trial origin from email", { ...trial, trialOrigin: "email" as Origin }],
    ["keep flag set", { ...trial, keepFlag: true }],
    ["notice not sent", { ...trial, noticeSent: false }],
    ["not a trial", { ...trial, isTrial: false, status: "active" }],
  ])("requires confirmation: %s", (_n, sub) => {
    expect(decide(cancel, snap({ subscription: sub })).decision).toBe("require_confirm");
  });
  it("requires confirmation when auto_cancel_trials is disabled", () => {
    const r = decide(
      cancel,
      snap({ subscription: trial }, (p) => {
        ((p.subscriptions as Record<string, unknown>).auto_cancel_trials as Record<string, unknown>).enabled = false;
      }),
    );
    expect(r.decision).toBe("require_confirm");
  });
  it("denies when the mandate denies cancellation", () => {
    const r = decide(
      cancel,
      snap({ subscription: { ...trial, isTrial: false } }, (p) => {
        (p.subscriptions as Record<string, unknown>).cancel = "deny";
      }),
    );
    expect(r.decision).toBe("deny");
  });
  it("denies cancelling an unknown subscription", () => {
    expect(decide(cancel, snap()).decision).toBe("deny");
  });
  it("one-tap approval allows a normal cancel", () => {
    const r = decide(cancel, snap({ subscription: { ...trial, isTrial: false, status: "active" }, approval: { valid: true } }));
    expect(r.decision).toBe("allow");
    expect(r.amountBase).toBe(0);
  });
});

describe("decide: prepaid (architecture §24.9)", () => {
  const plan = { owner: OWNER, merchant: MERCHANT, agent: AGENT, status: "active" as const, unitPrice: 100, unitsLeft: 48, nextSession: 13 };
  const attestation = { signerIsOracle: true, kind: "court_enforcement" as const, merchantMatches: true, ageDays: 0.5, expired: false };
  const base = (over: Partial<PrepaidFacts>): PrepaidFacts => ({ actor: "agent", ownerWallet: OWNER, plan, ...over });
  const offer = { merchantSigValid: true, expired: false, termsMatchStored: true, escrowSupported: true, totalBase: 6000 };

  const purchase = (actor: "user" | "agent") => ({ tool: "prepaid_purchase", actor, args: { offer_id: "o1" } }) as unknown as TypedAction;
  const redeem = (n = 13): TypedAction => ({ tool: "prepaid_redeem", actor: "user", args: { plan_id: "p1", session_no: n } });
  const exit: TypedAction = { tool: "prepaid_exit", actor: "agent", args: { plan_id: "p1" } };
  const voluntary: TypedAction = { tool: "prepaid_exit_voluntary", actor: "user", args: { plan_id: "p1" } };

  type Row = { name: string; action: TypedAction; facts: PrepaidFacts; expected: string; rule: string; over?: Patch; patch?: PolicyPatch };
  const rows: Row[] = [
    { name: "agent purchase", action: purchase("agent"), facts: base({ offer, consumerSigValid: true }), expected: "deny", rule: "prepaid.agent_cannot_purchase" },
    { name: "user purchase, all valid", action: purchase("user"), facts: base({ actor: "user", offer, consumerSigValid: true }), expected: "allow", rule: "prepaid.purchase" },
    { name: "purchase without consumer sig", action: purchase("user"), facts: base({ actor: "user", offer, consumerSigValid: false }), expected: "deny", rule: "prepaid.purchase" },
    {
      name: "purchase with purchase: deny",
      action: purchase("user"),
      facts: base({ actor: "user", offer, consumerSigValid: true }),
      expected: "deny",
      rule: "prepaid.purchase",
      patch: (p) => {
        (p.prepaid as Record<string, unknown>).purchase = "deny";
      },
    },
    { name: "bad merchant sig", action: purchase("user"), facts: base({ actor: "user", offer: { ...offer, merchantSigValid: false }, consumerSigValid: true }), expected: "deny", rule: "prepaid.offer_valid" },
    { name: "expired offer", action: purchase("user"), facts: base({ actor: "user", offer: { ...offer, expired: true }, consumerSigValid: true }), expected: "deny", rule: "prepaid.offer_valid" },
    { name: "terms differ from stored", action: purchase("user"), facts: base({ actor: "user", offer: { ...offer, termsMatchStored: false }, consumerSigValid: true }), expected: "deny", rule: "prepaid.offer_valid" },
    { name: "no escrow with escrow_only", action: purchase("user"), facts: base({ actor: "user", offer: { ...offer, escrowSupported: false }, consumerSigValid: true }), expected: "deny", rule: "prepaid.escrow_only" },
    {
      name: "no escrow with escrow_only false",
      action: purchase("user"),
      facts: base({ actor: "user", offer: { ...offer, escrowSupported: false }, consumerSigValid: true }),
      expected: "allow",
      rule: "prepaid.escrow_only",
      patch: (p) => {
        (p.prepaid as Record<string, unknown>).escrow_only = false;
      },
    },
    { name: "over max_prepay", action: purchase("user"), facts: base({ actor: "user", offer: { ...offer, totalBase: 9000 }, consumerSigValid: true }), expected: "deny", rule: "prepaid.max_prepay" },
    { name: "redeem, all valid", action: redeem(), facts: base({ actor: "user", consumerSigValid: true, merchantSigValid: true, sessionNo: 13 }), expected: "allow", rule: "prepaid.redeem" },
    { name: "redeem, single signature", action: redeem(), facts: base({ actor: "user", consumerSigValid: true, merchantSigValid: false, sessionNo: 13 }), expected: "deny", rule: "prepaid.redeem" },
    { name: "redeem, wrong session", action: redeem(14), facts: base({ actor: "user", consumerSigValid: true, merchantSigValid: true, sessionNo: 14 }), expected: "deny", rule: "prepaid.redeem" },
    { name: "redeem, other owner", action: redeem(), facts: base({ actor: "user", ownerWallet: AGENT, consumerSigValid: true, merchantSigValid: true }), expected: "deny", rule: "prepaid.redeem" },
    { name: "redeem, inactive plan", action: redeem(), facts: base({ actor: "user", plan: { ...plan, status: "exited_attested" }, consumerSigValid: true, merchantSigValid: true }), expected: "deny", rule: "prepaid.redeem" },
    {
      name: "redeem over daily cap",
      action: redeem(),
      facts: base({ actor: "user", consumerSigValid: true, merchantSigValid: true }),
      expected: "deny",
      rule: "global.daily_outflow_cap",
      over: { caps: { dailyUsed: 950, dailyCap: 1000 } },
    },
    { name: "attested exit, all valid", action: exit, facts: base({ agentIsOurs: true, attestation }), expected: "allow", rule: "prepaid.auto_exit_on" },
    // Without a valid attestation the exit is voluntary: deny unless the consumer signed it.
    { name: "exit, no attestation, unsigned", action: exit, facts: base({ agentIsOurs: true, attestation: null }), expected: "deny", rule: "prepaid.auto_exit_on" },
    { name: "exit, no attestation, consumer signed", action: exit, facts: base({ agentIsOurs: true, attestation: null, consumerSigValid: true }), expected: "require_confirm", rule: "prepaid.auto_exit_on" },
    { name: "exit, signer not oracle", action: exit, facts: base({ agentIsOurs: true, attestation: { ...attestation, signerIsOracle: false } }), expected: "deny", rule: "prepaid.auto_exit_on" },
    { name: "exit, signer not oracle, consumer signed", action: exit, facts: base({ agentIsOurs: true, attestation: { ...attestation, signerIsOracle: false }, consumerSigValid: true }), expected: "require_confirm", rule: "prepaid.auto_exit_on" },
    { name: "exit, other merchant", action: exit, facts: base({ agentIsOurs: true, attestation: { ...attestation, merchantMatches: false } }), expected: "deny", rule: "prepaid.auto_exit_on" },
    { name: "exit, stale attestation", action: exit, facts: base({ agentIsOurs: true, attestation: { ...attestation, ageDays: 3 } }), expected: "deny", rule: "prepaid.auto_exit_on" },
    { name: "exit, expired attestation", action: exit, facts: base({ agentIsOurs: true, attestation: { ...attestation, expired: true } }), expected: "deny", rule: "prepaid.auto_exit_on" },
    {
      name: "exit, kind not in auto_exit_on",
      action: exit,
      facts: base({ agentIsOurs: true, attestation: { ...attestation, kind: "closure_notice" } }),
      expected: "deny",
      rule: "prepaid.auto_exit_on",
      patch: (p) => {
        (p.prepaid as Record<string, unknown>).auto_exit_on = ["court_enforcement"];
      },
    },
    // The plan itself must be ours: deny, even with a consumer signature or an approval.
    { name: "exit, agent not ours", action: exit, facts: base({ agentIsOurs: false, attestation }), expected: "deny", rule: "prepaid.exit_plan" },
    { name: "exit, agent not ours, consumer signed", action: exit, facts: base({ agentIsOurs: false, attestation: null, consumerSigValid: true }), expected: "deny", rule: "prepaid.exit_plan" },
    { name: "exit, owner is not the user", action: exit, facts: base({ ownerWallet: AGENT, agentIsOurs: true, attestation }), expected: "deny", rule: "prepaid.exit_plan" },
    { name: "exit, inactive plan", action: exit, facts: base({ plan: { ...plan, status: "exited_voluntary" }, agentIsOurs: true, attestation, consumerSigValid: true }), expected: "deny", rule: "prepaid.exit_plan" },
    { name: "exit, unknown plan", action: exit, facts: base({ plan: null }), expected: "deny", rule: "provenance.prepaid_plan" },
    { name: "voluntary exit, signed", action: voluntary, facts: base({ actor: "user", consumerSigValid: true }), expected: "allow", rule: "prepaid.exit_voluntary" },
    { name: "voluntary exit, unsigned", action: voluntary, facts: base({ actor: "user", consumerSigValid: false }), expected: "deny", rule: "prepaid.exit_voluntary" },
  ];

  it.each(rows)("$name → $expected ($rule)", ({ action, facts, expected, rule, over, patch }) => {
    const r = decide(action, snap({ prepaid: facts, ...over }, patch));
    expect(r.decision).toBe(expected);
    expect(r.trace.some((x) => x.ruleId === rule)).toBe(true);
    if (expected !== "allow") expect(r.ruleIds).toContain(rule);
  });

  it("an approval never turns an unsigned, unattested exit into allow", () => {
    const r = decide(exit, snap({ prepaid: base({ agentIsOurs: true, attestation: null }), approval: { valid: true } }));
    expect(r.decision).toBe("deny");
    expect(r.reasons).toContain("prepaid.exit_use_voluntary_flow");
    const other = decide(exit, snap({ prepaid: base({ ownerWallet: AGENT, agentIsOurs: true, attestation: null, consumerSigValid: true }), approval: { valid: true } }));
    expect(other.decision).toBe("deny");
  });

  it("an approval with the consumer's signature confirms a voluntary-style exit", () => {
    const r = decide(exit, snap({ prepaid: base({ agentIsOurs: true, attestation: null, consumerSigValid: true }), approval: { valid: true } }));
    expect(r.decision).toBe("allow");
    expect(r.ruleIds).toContain("approval.valid");
  });

  it("kill switch denies every prepaid action", () => {
    for (const a of [exit, voluntary, redeem()]) {
      expect(decide(a, snap({ killSwitch: true, prepaid: base({ agentIsOurs: true, attestation }) })).decision).toBe("deny");
    }
  });

  it("escrow deposits do not count toward the daily cap", () => {
    const r = decide(purchase("user"), snap({ prepaid: base({ actor: "user", offer, consumerSigValid: true }), caps: { dailyUsed: 1000, dailyCap: 1000 } }));
    expect(r.decision).toBe("allow");
    expect(r.amountBase).toBe(0);
  });

  it("session releases count toward the daily cap", () => {
    const r = decide(redeem(), snap({ prepaid: base({ actor: "user", consumerSigValid: true, merchantSigValid: true }) }));
    expect(r.amountBase).toBe(100);
  });

  // ---- Additional §24.9 rows (cap boundary, session mismatch, inactive/foreign plans, oracle
  // trigger, chain-only plan state). Same runner as the table above. ----
  const signed = { consumerSigValid: true, merchantSigValid: true } as const;
  const user = (over: Partial<PrepaidFacts> = {}): PrepaidFacts => base({ actor: "user", ...signed, ...over });
  const exitFacts = (att: PrepaidFacts["attestation"], over: Partial<PrepaidFacts> = {}): PrepaidFacts =>
    base({ agentIsOurs: true, attestation: att, ...over });
  const MIXED = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";
  const INACTIVE = ["completed", "exited_attested", "exited_voluntary"] as const;

  const extraRows: Row[] = [
    // redeem: one unit price (100) against the remaining daily cap (1000 in the mandate)
    { name: "redeem, unit price exactly fits the remaining cap", action: redeem(), facts: user(), expected: "allow", rule: "global.daily_outflow_cap", over: { caps: { dailyUsed: 900, dailyCap: 1000 } } },
    { name: "redeem, one yuan over the remaining cap", action: redeem(), facts: user(), expected: "deny", rule: "global.daily_outflow_cap", over: { caps: { dailyUsed: 901, dailyCap: 1000 } } },
    { name: "redeem, snapshot cap tighter than the mandate", action: redeem(), facts: user(), expected: "deny", rule: "global.daily_outflow_cap", over: { caps: { dailyUsed: 401, dailyCap: 500 } } },
    { name: "redeem, snapshot cap looser than the mandate", action: redeem(), facts: user(), expected: "deny", rule: "global.daily_outflow_cap", over: { caps: { dailyUsed: 901, dailyCap: 5000 } } },
    { name: "redeem, cap already spent", action: redeem(), facts: user(), expected: "deny", rule: "global.daily_outflow_cap", over: { caps: { dailyUsed: 1000, dailyCap: 1000 } } },
    // redeem: the session number in the facts or the args differs from the plan's next session
    { name: "redeem, signed session behind the argument", action: redeem(13), facts: user({ sessionNo: 12 }), expected: "deny", rule: "prepaid.redeem" },
    { name: "redeem, signed session ahead of the argument", action: redeem(13), facts: user({ sessionNo: 14 }), expected: "deny", rule: "prepaid.redeem" },
    { name: "redeem, argument and signature agree but ahead of the plan", action: redeem(14), facts: user({ sessionNo: 14 }), expected: "deny", rule: "prepaid.redeem" },
    { name: "redeem, argument and signature agree but behind the plan", action: redeem(12), facts: user({ sessionNo: 12 }), expected: "deny", rule: "prepaid.redeem" },
    { name: "redeem, signed session matches the plan", action: redeem(13), facts: user({ sessionNo: 13 }), expected: "allow", rule: "prepaid.redeem" },
    // redeem: plan state and signatures
    ...INACTIVE.map((status): Row => ({ name: `redeem, plan ${status}`, action: redeem(), facts: user({ plan: { ...plan, status } }), expected: "deny", rule: "prepaid.redeem" })),
    { name: "redeem, no owner wallet on file", action: redeem(), facts: user({ ownerWallet: null }), expected: "deny", rule: "prepaid.redeem" },
    { name: "redeem, consumer signature missing", action: redeem(), facts: user({ consumerSigValid: false }), expected: "deny", rule: "prepaid.redeem" },
    { name: "redeem, signatures not evaluated", action: redeem(), facts: base({ actor: "user" }), expected: "deny", rule: "prepaid.redeem" },
    { name: "redeem, plan not read from the chain", action: redeem(), facts: user({ plan: null }), expected: "deny", rule: "provenance.prepaid_plan" },
    // voluntary exit: inactive plan, someone else's plan, unknown plan
    ...INACTIVE.map((status): Row => ({ name: `voluntary exit, plan ${status}`, action: voluntary, facts: base({ actor: "user", consumerSigValid: true, plan: { ...plan, status } }), expected: "deny", rule: "prepaid.exit_voluntary" })),
    { name: "voluntary exit, another owner's plan", action: voluntary, facts: base({ actor: "user", consumerSigValid: true, ownerWallet: AGENT }), expected: "deny", rule: "prepaid.exit_voluntary" },
    { name: "voluntary exit, no owner wallet on file", action: voluntary, facts: base({ actor: "user", consumerSigValid: true, ownerWallet: null }), expected: "deny", rule: "prepaid.exit_voluntary" },
    { name: "voluntary exit, signature not evaluated", action: voluntary, facts: base({ actor: "user" }), expected: "deny", rule: "prepaid.exit_voluntary" },
    { name: "voluntary exit, plan not read from the chain", action: voluntary, facts: base({ actor: "user", consumerSigValid: true, plan: null }), expected: "deny", rule: "provenance.prepaid_plan" },
    {
      name: "voluntary exit, owner addresses differ only by case",
      action: voluntary,
      facts: base({ actor: "user", consumerSigValid: true, plan: { ...plan, owner: MIXED }, ownerWallet: MIXED.toLowerCase() }),
      expected: "allow",
      rule: "prepaid.exit_voluntary",
    },
    // purchase
    { name: "purchase, facts say the actor is the agent", action: purchase("user"), facts: base({ actor: "agent", offer, consumerSigValid: true }), expected: "deny", rule: "prepaid.purchase" },
    { name: "purchase, offer facts missing", action: purchase("user"), facts: base({ actor: "user", consumerSigValid: true }), expected: "deny", rule: "prepaid.offer_valid" },
    { name: "purchase, exactly max_prepay", action: purchase("user"), facts: base({ actor: "user", offer: { ...offer, totalBase: 8000 }, consumerSigValid: true }), expected: "allow", rule: "prepaid.max_prepay" },
    { name: "purchase, one yuan over max_prepay", action: purchase("user"), facts: base({ actor: "user", offer: { ...offer, totalBase: 8001 }, consumerSigValid: true }), expected: "deny", rule: "prepaid.max_prepay" },
    {
      name: "purchase, mandate prepaid block omitted (defaults to deny)",
      action: purchase("user"),
      facts: base({ actor: "user", offer, consumerSigValid: true }),
      expected: "deny",
      rule: "prepaid.purchase",
      patch: (p) => {
        delete p.prepaid;
      },
    },
    // oracle exit trigger (PRD §10.3): signer, merchant, age, kind
    { name: "exit, attestation exactly at max age", action: exit, facts: exitFacts({ ...attestation, ageDays: 2 }), expected: "allow", rule: "prepaid.auto_exit_on" },
    { name: "exit, attestation just past max age", action: exit, facts: exitFacts({ ...attestation, ageDays: 2.0001 }), expected: "deny", rule: "prepaid.auto_exit_on" },
    { name: "exit, attestation dated in the future", action: exit, facts: exitFacts({ ...attestation, ageDays: -0.1 }), expected: "deny", rule: "prepaid.auto_exit_on" },
    { name: "exit, brand-new attestation", action: exit, facts: exitFacts({ ...attestation, ageDays: 0 }), expected: "allow", rule: "prepaid.auto_exit_on" },
    {
      name: "exit, mandate max age 0 and a same-day attestation",
      action: exit,
      facts: exitFacts({ ...attestation, ageDays: 0 }),
      expected: "allow",
      rule: "prepaid.auto_exit_on",
      patch: (p) => {
        (p.prepaid as Record<string, unknown>).attestation_max_age_days = 0;
      },
    },
    {
      name: "exit, mandate max age 0 and a slightly older attestation",
      action: exit,
      facts: exitFacts({ ...attestation, ageDays: 0.1 }),
      expected: "deny",
      rule: "prepaid.auto_exit_on",
      patch: (p) => {
        (p.prepaid as Record<string, unknown>).attestation_max_age_days = 0;
      },
    },
    { name: "exit, closure_notice listed in the mandate", action: exit, facts: exitFacts({ ...attestation, kind: "closure_notice" }), expected: "allow", rule: "prepaid.auto_exit_on" },
    {
      name: "exit, mandate lists no kinds",
      action: exit,
      facts: exitFacts(attestation),
      expected: "deny",
      rule: "prepaid.auto_exit_on",
      patch: (p) => {
        (p.prepaid as Record<string, unknown>).auto_exit_on = [];
      },
    },
    {
      name: "exit, kind not listed but consumer signed",
      action: exit,
      facts: exitFacts({ ...attestation, kind: "closure_notice" }, { consumerSigValid: true }),
      expected: "require_confirm",
      rule: "prepaid.auto_exit_on",
      patch: (p) => {
        (p.prepaid as Record<string, unknown>).auto_exit_on = ["court_enforcement"];
      },
    },
    { name: "exit, expired attestation but consumer signed", action: exit, facts: exitFacts({ ...attestation, expired: true }, { consumerSigValid: true }), expected: "require_confirm", rule: "prepaid.auto_exit_on" },
    { name: "exit, other merchant but consumer signed", action: exit, facts: exitFacts({ ...attestation, merchantMatches: false }, { consumerSigValid: true }), expected: "require_confirm", rule: "prepaid.auto_exit_on" },
    { name: "exit, stale attestation but consumer signed", action: exit, facts: exitFacts({ ...attestation, ageDays: 3 }, { consumerSigValid: true }), expected: "require_confirm", rule: "prepaid.auto_exit_on" },
    { name: "exit, agent ownership not evaluated", action: exit, facts: base({ attestation }), expected: "deny", rule: "prepaid.exit_plan" },
    { name: "exit, plan names no agent", action: exit, facts: exitFacts(attestation, { plan: { ...plan, agent: null }, agentIsOurs: false }), expected: "deny", rule: "prepaid.exit_plan" },
    { name: "exit, no owner wallet on file", action: exit, facts: exitFacts(attestation, { ownerWallet: null }), expected: "deny", rule: "prepaid.exit_plan" },
    ...INACTIVE.map((status): Row => ({ name: `exit, plan ${status}`, action: exit, facts: exitFacts(attestation, { plan: { ...plan, status } }), expected: "deny", rule: "prepaid.exit_plan" })),
  ];

  it.each(extraRows)("$name → $expected ($rule)", ({ action, facts, expected, rule, over, patch }) => {
    const r = decide(action, snap({ prepaid: facts, ...over }, patch));
    expect(r.decision).toBe(expected);
    expect(r.trace.some((x) => x.ruleId === rule)).toBe(true);
    if (expected !== "allow") expect(r.ruleIds).toContain(rule);
  });

  it("redeem reports the unit price as the amount even when it is denied", () => {
    const r = decide(redeem(), snap({ prepaid: user(), caps: { dailyUsed: 901, dailyCap: 1000 } }));
    expect(r.decision).toBe("deny");
    expect(r.amountBase).toBe(100);
  });

  it("a redeem at the cap boundary denies only the cap rule, not the signatures", () => {
    const r = decide(redeem(), snap({ prepaid: user(), caps: { dailyUsed: 901, dailyCap: 1000 } }));
    expect(r.ruleIds).toEqual(["global.daily_outflow_cap"]);
    expect(r.trace.find((x) => x.ruleId === "prepaid.redeem")?.result).toBe("allow");
  });

  it("a snapshot per-payee cap also bounds a redeem", () => {
    const fits = decide(redeem(), snap({ prepaid: user(), caps: { dailyUsed: 0, dailyCap: 1000, perPayeeCap: 100, perPayeeUsed: 0 } }));
    expect(fits.decision).toBe("allow");
    const over = decide(redeem(), snap({ prepaid: user(), caps: { dailyUsed: 0, dailyCap: 1000, perPayeeCap: 100, perPayeeUsed: 1 } }));
    expect(over.decision).toBe("deny");
    expect(over.ruleIds).toEqual(["global.per_payee_daily_cap"]);
  });

  // Plan state is accepted from the chain read only (PRD §10.3); no facts means no plan.
  it.each([
    ["redeem", redeem()],
    ["exit", exit],
    ["voluntary exit", voluntary],
  ])("denies %s when no prepaid facts were built", (_n, action) => {
    const r = decide(action, snap({ approval: { valid: true } }));
    expect(r.decision).toBe("deny");
    expect(r.ruleIds).toEqual(["provenance.prepaid_plan"]);
  });

  it("denies a purchase when no prepaid facts were built", () => {
    const r = decide(purchase("user"), snap({ approval: { valid: true } }));
    expect(r.decision).toBe("deny");
    expect(r.ruleIds).toEqual(["prepaid.offer_valid"]);
    expect(r.reasons).toEqual(["prepaid.offer_missing"]);
  });

  it("an agent purchase is denied alone, even with a valid approval and valid facts", () => {
    const r = decide(purchase("agent"), snap({ prepaid: base({ offer, consumerSigValid: true }), approval: { valid: true } }));
    expect(r.decision).toBe("deny");
    expect(r.ruleIds).toEqual(["prepaid.agent_cannot_purchase"]);
    expect(r.amountBase).toBe(0);
  });

  it("a valid approval never upgrades a prepaid deny", () => {
    const denied: [string, TypedAction, PrepaidFacts][] = [
      ["purchase over max_prepay", purchase("user"), base({ actor: "user", offer: { ...offer, totalBase: 9000 }, consumerSigValid: true })],
      ["purchase without consumer signature", purchase("user"), base({ actor: "user", offer, consumerSigValid: false })],
      ["redeem with one signature", redeem(), user({ merchantSigValid: false })],
      ["redeem of the wrong session", redeem(14), user({ sessionNo: 14 })],
      ["voluntary exit unsigned", voluntary, base({ actor: "user", consumerSigValid: false })],
      ["voluntary exit of another owner's plan", voluntary, base({ actor: "user", consumerSigValid: true, ownerWallet: AGENT })],
      ["exit of a finished plan", exit, exitFacts(attestation, { plan: { ...plan, status: "completed" }, consumerSigValid: true })],
    ];
    for (const [name, action, facts] of denied) {
      const r = decide(action, snap({ prepaid: facts, approval: { valid: true } }));
      expect(r.decision, name).toBe("deny");
      expect(r.ruleIds, name).not.toContain("approval.valid");
    }
  });

  it("a valid approval does not rescue a redeem that exceeds the cap", () => {
    const r = decide(redeem(), snap({ prepaid: user(), caps: { dailyUsed: 901, dailyCap: 1000 }, approval: { valid: true } }));
    expect(r.decision).toBe("deny");
  });

  it("purchase: mandate purchase deny stays denied with a valid approval", () => {
    const r = decide(
      purchase("user"),
      snap({ prepaid: base({ actor: "user", offer, consumerSigValid: true }), approval: { valid: true } }, (p) => {
        (p.prepaid as Record<string, unknown>).purchase = "deny";
      }),
    );
    expect(r.decision).toBe("deny");
    expect(r.ruleIds).toEqual(["prepaid.purchase"]);
  });

  // Actor and argument schema for the prepaid tools.
  it.each([
    ["an agent redeem", { tool: "prepaid_redeem", actor: "agent", args: { plan_id: "p1", session_no: 13 } }],
    ["an agent voluntary exit", { tool: "prepaid_exit_voluntary", actor: "agent", args: { plan_id: "p1" } }],
    ["a user-submitted attested exit", { tool: "prepaid_exit", actor: "user", args: { plan_id: "p1" } }],
  ])("denies %s as the wrong actor", (_n, action) => {
    const r = decide(action as unknown as TypedAction, snap({ prepaid: user({ agentIsOurs: true, attestation }) }));
    expect(r.decision).toBe("deny");
    expect(r.reasons).toEqual(["schema.wrong_actor"]);
  });

  it.each([
    ["session_no 0", { tool: "prepaid_redeem", actor: "user", args: { plan_id: "p1", session_no: 0 } }],
    ["fractional session_no", { tool: "prepaid_redeem", actor: "user", args: { plan_id: "p1", session_no: 1.5 } }],
    ["string session_no", { tool: "prepaid_redeem", actor: "user", args: { plan_id: "p1", session_no: "13" } }],
    ["a recipient on redeem", { tool: "prepaid_redeem", actor: "user", args: { plan_id: "p1", session_no: 13, recipient: AGENT } }],
    ["a recipient on exit", { tool: "prepaid_exit", actor: "agent", args: { plan_id: "p1", recipient: AGENT } }],
    ["a recipient on voluntary exit", { tool: "prepaid_exit_voluntary", actor: "user", args: { plan_id: "p1", to: AGENT } }],
    ["an empty plan id", { tool: "prepaid_exit", actor: "agent", args: { plan_id: "" } }],
    ["an extra field on purchase", { tool: "prepaid_purchase", actor: "user", args: { offer_id: "o1", payee: AGENT } }],
  ])("schema denies %s", (_n, action) => {
    const r = decide(action as unknown as TypedAction, snap({ prepaid: user({ agentIsOurs: true, attestation, offer }) }));
    expect(r.decision).toBe("deny");
    expect(r.reasons).toEqual(["schema.invalid_args"]);
  });

  describe("rule ids", () => {
    const traceIds = (rs: Row[]) => {
      const seen = new Set<string>();
      for (const { action, facts, over, patch } of rs) {
        for (const x of decide(action, snap({ prepaid: facts, ...over }, patch)).trace) seen.add(x.ruleId);
      }
      return seen;
    };

    it("lists each id once", () => {
      expect(new Set(PREPAID_RULE_IDS).size).toBe(PREPAID_RULE_IDS.length);
    });

    it("every listed id appears in at least one table row's trace", () => {
      const seen = traceIds([...rows, ...extraRows]);
      const missing = PREPAID_RULE_IDS.filter((id) => !seen.has(id));
      expect(missing).toEqual([]);
    });

    it("every denying or confirming id in a row's expectation is a listed id", () => {
      const listed = new Set<string>(PREPAID_RULE_IDS);
      for (const row of [...rows, ...extraRows]) expect(listed.has(row.rule), row.name).toBe(true);
    });

    it("decide emits no prepaid.* id that is missing from the list", () => {
      const listed = new Set<string>(PREPAID_RULE_IDS);
      const unlisted = [...traceIds([...rows, ...extraRows])].filter((id) => id.startsWith("prepaid.") && !listed.has(id));
      expect(unlisted).toEqual([]);
    });
  });
});

// PRD §10.3 provenance matrix rows that the pay_bill table above does not reach.
const ORIGIN_MAP: Record<Origin, true> = {
  user: true,
  registry: true,
  mock_bank: true,
  aggregator: true,
  fx_provider: true,
  chain: true,
  oracle: true,
  email: true,
  document: true,
  notification: true,
  csv: true,
  web: true,
  simulated: true,
};
const ALL_ORIGINS = Object.keys(ORIGIN_MAP) as Origin[];

describe("decide: provenance matrix, amount origin (PRD §10.3)", () => {
  const prov = (amountOrigin: Origin | null, destinationOrigin: Origin | null = "registry") => ({ destinationOrigin, amountOrigin, amountMatchesBill: true });

  it.each(ALL_ORIGINS.filter((o) => !["mock_bank", "aggregator", "document", "email"].includes(o)))(
    "amount from %s needs confirmation and is never auto-paid",
    (origin) => {
      const r = decide(pay(), snap({ provenance: prov(origin) }));
      expect(r.decision).toBe("require_confirm");
      expect(r.trace.find((x) => x.ruleId === "provenance.amount")).toMatchObject({ result: "require_confirm", reason: "provenance.amount_untrusted_origin" });
      expect(r.reasons).toContain("provenance.amount_untrusted_origin");
    },
  );

  it.each(["web", "simulated"] as const)("a %s amount is upgraded only by a valid approval, which is the user's decision", (origin) => {
    expect(decide(pay(), snap({ provenance: prov(origin), approval: { valid: true } })).decision).toBe("allow");
    expect(decide(pay(), snap({ provenance: prov(origin), approval: { valid: false, reason: "expired" } })).decision).toBe("require_confirm");
    expect(decide(pay(), snap({ provenance: prov(origin), approval: null })).decision).toBe("require_confirm");
  });

  it.each(["web", "simulated"] as const)("a %s amount never overrides a deny from another rule", (origin) => {
    const r = decide(pay(), snap({ provenance: prov(origin), approval: { valid: true }, caps: { dailyUsed: 950, dailyCap: 1000 } }));
    expect(r.decision).toBe("deny");
  });

  it.each(ALL_ORIGINS.filter((o) => o !== "registry"))("destination from %s is denied, whatever the amount origin", (dest) => {
    const r = decide(pay(), snap({ provenance: prov("mock_bank", dest), approval: { valid: true } }));
    expect(r.decision).toBe("deny");
    expect(r.ruleIds).toEqual(["provenance.destination"]);
  });

  describe("document / email amounts need a registered biller, amount <= auto_pay_max and a passing anomaly check", () => {
    const flat = (n: number) => [n, n, n, n, n];
    it.each(["document", "email"] as const)("%s amount exactly at auto_pay_max with a flat history is trusted", (origin) => {
      const r = decide(pay(300, "SZ_POWER"), snap({ provenance: prov(origin), payee: electricity.payee, history: { amounts: flat(300) } }));
      expect(r.trace.find((x) => x.ruleId === "provenance.amount")?.result).toBe("allow");
      expect(r.decision).toBe("allow");
    });
    it.each(["document", "email"] as const)("%s amount one yuan over auto_pay_max needs confirmation", (origin) => {
      const r = decide(pay(301, "SZ_POWER"), snap({ provenance: prov(origin), payee: electricity.payee, history: { amounts: flat(301) } }));
      expect(r.trace.find((x) => x.ruleId === "provenance.amount")?.result).toBe("require_confirm");
      expect(r.decision).toBe("require_confirm");
    });
    it.each(["document", "email"] as const)("%s amount with too little history needs confirmation", (origin) => {
      const r = decide(pay(), snap({ provenance: prov(origin), history: { amounts: [98, 98] } }));
      expect(r.trace.find((x) => x.ruleId === "provenance.amount")?.result).toBe("require_confirm");
    });
    it.each(["document", "email"] as const)("%s amount for a biller outside the registry is not trusted", (origin) => {
      const r = decide(pay(), snap({ provenance: prov(origin), payee: { billerId: "CHINA_MOBILE", inRegistry: false, verified: false } }));
      expect(r.trace.find((x) => x.ruleId === "provenance.amount")?.result).toBe("require_confirm");
      expect(r.decision).toBe("deny");
    });
    it("a document amount in a foreign currency is judged on the converted amount against auto_pay_max", () => {
      // 50 * 7.1 * 1.03 = 365.65 -> 366 > 300, though 50 itself is not.
      const r = decide(
        pay(50),
        snap({ provenance: prov("document"), fx: { rate: 7.1, date: "2026-10-16", source: "fx_provider" }, history: { amounts: flat(50) } }),
      );
      expect(r.amountBase).toBe(366);
      expect(r.trace.find((x) => x.ruleId === "provenance.amount")?.result).toBe("require_confirm");
    });
  });
});

describe("decide: provenance matrix, FX rate source and age (PRD §10.3)", () => {
  const foreignHistory = { amounts: [147, 147, 147] };
  const fxSnap = (fx: GateSnapshot["fx"], over: Patch = {}) => snap({ fx, history: foreignHistory, ...over });
  const fresh = { rate: 7.1, date: "2026-10-16", source: "fx_provider" as const };

  it.each(["ecb", "web", "simulated", "user", ""])("denies a rate whose source is %j", (source) => {
    const r = decide(pay(20), fxSnap({ ...fresh, source } as unknown as GateSnapshot["fx"]));
    expect(r.decision).toBe("deny");
    expect(r.ruleIds).toEqual(["fx.rate_fresh"]);
    expect(r.reasons).toContain("fx.rate_stale_or_unknown");
  });

  it.each([0, -7.1, Number.NaN])("denies a non-positive or NaN rate (%d)", (rate) => {
    const r = decide(pay(20), fxSnap({ ...fresh, rate }));
    expect(r.decision).toBe("deny");
    expect(r.ruleIds).toContain("fx.rate_fresh");
  });

  it("denies the epoch-dated placeholder used for an unknown rate", () => {
    const r = decide(pay(20), fxSnap({ rate: 0, date: "1970-01-01", source: "fx_provider" }));
    expect(r.decision).toBe("deny");
    expect(r.ruleIds).toContain("fx.rate_fresh");
  });

  it("allows a rate exactly two days old and denies one millisecond older", () => {
    expect(decide(pay(20), fxSnap({ ...fresh, date: "2026-10-15T08:00:00.000Z" })).trace.find((x) => x.ruleId === "fx.rate_fresh")?.result).toBe("allow");
    const r = decide(pay(20), fxSnap({ ...fresh, date: "2026-10-15T07:59:59.999Z" }));
    expect(r.trace.find((x) => x.ruleId === "fx.rate_fresh")?.result).toBe("deny");
    expect(r.decision).toBe("deny");
  });

  it("denies a rate dated in the future", () => {
    const r = decide(pay(20), fxSnap({ ...fresh, date: "2026-10-17T08:00:00.001Z" }));
    expect(r.decision).toBe("deny");
    expect(r.ruleIds).toContain("fx.rate_fresh");
  });

  it("allows a rate stamped at exactly now", () => {
    expect(decide(pay(20), fxSnap({ ...fresh, date: NOW })).trace.find((x) => x.ruleId === "fx.rate_fresh")?.result).toBe("allow");
  });

  it("a valid approval does not rescue a stale rate", () => {
    const r = decide(pay(20), fxSnap({ ...fresh, date: "2026-10-10" }, { approval: { valid: true } }));
    expect(r.decision).toBe("deny");
    expect(r.ruleIds).toEqual(["fx.rate_fresh"]);
  });

  it("a stale rate still reports the converted amount it would have used", () => {
    const r = decide(pay(20), fxSnap({ ...fresh, date: "2026-10-10" }));
    expect(r.amountBase).toBe(Math.ceil(20 * 7.1 * 1.03));
  });

  it("the margin comes from the mandate (0% margin converts at the bare rate)", () => {
    expect(decide(pay(20), fxSnap(fresh)).amountBase).toBe(Math.ceil(20 * 7.1 * 1.03));
    const noMargin = decide(
      pay(20),
      snap({ fx: fresh, history: foreignHistory }, (p) => {
        (p.fx as Record<string, unknown>).margin_pct = 0;
      }),
    );
    expect(noMargin.amountBase).toBe(Math.ceil(20 * 7.1));
  });

  it("caps are checked on the converted amount", () => {
    // 20 * 7.1 * 1.03 = 146.26 -> 147; 900 + 147 > 1000
    const r = decide(pay(20), fxSnap(fresh, { caps: { dailyUsed: 900, dailyCap: 1000 } }));
    expect(r.decision).toBe("deny");
    expect(r.ruleIds).toEqual(["global.daily_outflow_cap"]);
  });
});

describe("decide: provenance matrix, trial status origin (PRD §10.3)", () => {
  const trial = { status: "trial", isTrial: true, trialOrigin: "mock_bank" as Origin | null, keepFlag: false, noticeSent: true };

  it.each(ALL_ORIGINS.filter((o) => o !== "mock_bank"))("a trial whose status comes from %s needs one-tap approval", (origin) => {
    const r = decide(cancel, snap({ subscription: { ...trial, trialOrigin: origin } }));
    expect(r.decision).toBe("require_confirm");
    expect(r.reasons).toContain("subscriptions.trial_origin_untrusted");
    expect(r.trace.find((x) => x.ruleId === "subscriptions.auto_cancel_trials")?.result).toBe("require_confirm");
  });

  it("a trial with no recorded status origin needs one-tap approval", () => {
    const r = decide(cancel, snap({ subscription: { ...trial, trialOrigin: null } }));
    expect(r.decision).toBe("require_confirm");
    expect(r.reasons).toContain("subscriptions.trial_origin_untrusted");
  });

  it("only mock_bank lets a trial auto-cancel", () => {
    const allowed = ALL_ORIGINS.filter((o) => decide(cancel, snap({ subscription: { ...trial, trialOrigin: o } })).decision === "allow");
    expect(allowed).toEqual(["mock_bank"]);
  });

  it("an untrusted origin is reported ahead of the keep flag and the missing notice", () => {
    const r = decide(cancel, snap({ subscription: { ...trial, trialOrigin: "email", keepFlag: true, noticeSent: false } }));
    expect(r.reasons).toContain("subscriptions.trial_origin_untrusted");
    expect(r.reasons).not.toContain("subscriptions.trial_keep_flag");
  });

  it("a valid approval turns an untrusted-origin trial cancel into allow", () => {
    const r = decide(cancel, snap({ subscription: { ...trial, trialOrigin: "web" }, approval: { valid: true } }));
    expect(r.decision).toBe("allow");
    expect(r.ruleIds).toContain("approval.valid");
  });

  it("a mandate that denies cancellation beats a trusted trial", () => {
    const r = decide(
      cancel,
      snap({ subscription: trial }, (p) => {
        (p.subscriptions as Record<string, unknown>).cancel = "deny";
      }),
    );
    expect(r.decision).toBe("deny");
    expect(r.ruleIds).toEqual(["subscriptions.cancel"]);
  });

  it("an already cancelled subscription is denied even with an approval", () => {
    const r = decide(cancel, snap({ subscription: { ...trial, status: "cancelled" }, approval: { valid: true } }));
    expect(r.decision).toBe("deny");
    expect(r.reasons).toEqual(["subscriptions.already_cancelled"]);
  });
});

describe("decide: provenance matrix, subscription to cancel (any origin, approval required)", () => {
  const active = { status: "active", isTrial: false, trialOrigin: null as Origin | null, keepFlag: false, noticeSent: false };

  it.each(ALL_ORIGINS)("a cancel that reached the Gate via %s needs approval, not a deny", (origin) => {
    // The subscription row's own origin is not a Gate input; neither are the bill origins on the snapshot.
    const s = snap({
      subscription: { ...active, trialOrigin: origin },
      provenance: { destinationOrigin: origin, amountOrigin: origin, amountMatchesBill: false },
    });
    const r = decide(cancel, s);
    expect(r.decision).toBe("require_confirm");
    expect(r.ruleIds).toContain("subscriptions.cancel");
    expect(r.trace.map((x) => x.ruleId)).not.toContain("provenance.destination");
    expect(r.trace.map((x) => x.ruleId)).not.toContain("provenance.amount_mismatch");
    expect(decide(cancel, { ...s, approval: { valid: true } }).decision).toBe("allow");
  });

  it("an expired or missing approval leaves the cancel waiting", () => {
    const s = snap({ subscription: active });
    expect(decide(cancel, { ...s, approval: { valid: false, reason: "expired" } }).decision).toBe("require_confirm");
    expect(decide(cancel, { ...s, approval: { valid: false, reason: "expired" } }).reasons).toContain("approval.expired");
    expect(decide(cancel, s).reasons).toContain("approval.missing");
  });

  it("a cancel moves no money", () => {
    expect(decide(cancel, snap({ subscription: active, approval: { valid: true } })).amountBase).toBe(0);
  });
});

describe("decide: determinism", () => {
  it("returns identical results for identical inputs", () => {
    const s = snap(electricity);
    expect(decide(pay(612, "SZ_POWER"), s)).toEqual(decide(pay(612, "SZ_POWER"), s));
  });
});
