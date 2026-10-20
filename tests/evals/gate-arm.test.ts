// Gate arm of the attack suite (PRD §20.3 arm B, architecture §18.2) for the cases that need
// only the pure Gate: prepaid and chain categories 19 to 22, 25 and 26. No DB, no model.
// Cases are declarative (evals/cases/gate/index.json); this file builds the snapshot and action
// and runs the real decide().

import { describe, expect, it } from "vitest";
import cases from "../../evals/cases/gate/index.json";
import { decide } from "../../src/core/gate/decide";
import { LIN_MANDATE_V3 } from "../../src/core/mandate/examples";
import type { GateSnapshot, PrepaidFacts, TypedAction } from "../../src/core/types";

type Json = Record<string, unknown>;
type Paths = Record<string, unknown>;
type GateCase = {
  id: string;
  category: number;
  categoryName: string;
  kind: "gate";
  base: keyof typeof cases.bases;
  inject: Paths;
  genuine: Paths;
  expected: { gate: { decision: string; ruleIds: string[]; reasons: string[] }; moneyMoved: boolean };
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Set `value` at a dotted path; every intermediate object must already exist. */
function setPath(root: Json, path: string, value: unknown): void {
  const keys = path.split(".");
  let node: Json = root;
  for (const key of keys.slice(0, -1)) {
    const next = node[key];
    if (typeof next !== "object" || next === null) throw new Error(`path ${path}: ${key} is not an object`);
    node = next as Json;
  }
  const last = keys[keys.length - 1]!;
  if (!(last in node)) throw new Error(`path ${path}: ${last} does not exist in the base`);
  node[last] = value;
}

function build(c: GateCase, patch: Paths): { action: TypedAction; snapshot: GateSnapshot } {
  const base = cases.bases[c.base];
  const root: Json = { action: clone(base.action), prepaid: clone(base.prepaid), policy: clone(LIN_MANDATE_V3) };
  for (const [path, value] of Object.entries(patch)) setPath(root, path, clone(value));
  const snapshot: GateSnapshot = {
    now: cases.now,
    killSwitch: false,
    mandate: { version: 3, hash: "h3", policy: root.policy, signatureValid: true },
    provenance: { destinationOrigin: "registry", amountOrigin: "mock_bank", amountMatchesBill: true },
    payee: null,
    history: { amounts: [] },
    fx: null,
    caps: { dailyUsed: 0, dailyCap: 1000 },
    approval: null,
    prepaid: root.prepaid as PrepaidFacts,
  };
  return { action: root.action as TypedAction, snapshot };
}

const gateCases = cases.cases as unknown as GateCase[];

describe("gate arm: case file", () => {
  it("covers the prepaid and chain categories this file owns", () => {
    const categories = new Set(gateCases.map((c) => c.category));
    expect([...categories].sort((a, b) => a - b)).toEqual([19, 20, 21, 22, 25, 26]);
  });

  it("has unique ids and only known bases", () => {
    expect(new Set(gateCases.map((c) => c.id)).size).toBe(gateCases.length);
    for (const c of gateCases) expect(Object.keys(cases.bases)).toContain(c.base);
  });

  it("injects and restores the same paths", () => {
    for (const c of gateCases) expect(Object.keys(c.genuine).sort()).toEqual(Object.keys(c.inject).sort());
  });
});

describe.each(gateCases.map((c) => [c.id, c] as const))("gate arm: %s", (_id, c) => {
  it("denies the attack and moves no money", () => {
    const { action, snapshot } = build(c, c.inject);
    const r = decide(action, snapshot);
    expect(r.decision).toBe(c.expected.gate.decision);
    expect(r.decision).not.toBe("allow");
    expect(c.expected.moneyMoved).toBe(false);
    for (const rule of c.expected.gate.ruleIds) expect(r.ruleIds).toContain(rule);
    for (const reason of c.expected.gate.reasons) expect(r.reasons).toContain(reason);
  });

  it("an approval does not rescue it", () => {
    const { action, snapshot } = build(c, c.inject);
    const r = decide(action, { ...snapshot, approval: { valid: true } });
    expect(r.decision).toBe("deny");
  });

  it("would be allowed if the injected element were genuine (not an always-deny)", () => {
    const { action, snapshot } = build(c, c.genuine);
    const r = decide(action, snapshot);
    expect(r.decision).toBe("allow");
  });
});
