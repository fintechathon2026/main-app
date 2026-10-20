import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { canonical } from "./canonical";
import { LIN_MANDATE_V3 } from "./examples";
import { comparableForm, compareMandates, equivalent, narrows, type FieldChange } from "./narrow";
import { parsePolicy, type Policy } from "./schema";

// A mandate with every optional block present and every field away from its extreme, so each
// field can move in both directions.
const BASE_INPUT = {
  version: 7,
  base_currency: "CNY",
  fx: { rate_source: "ecb_reference", margin_pct: 3 },
  payees: { allow: ["SZ_POWER", "CHINA_MOBILE", "LANDLORD_WANG"], new_payee: "confirm" },
  bills: {
    auto_pay_max: 300,
    anomaly: { method: "median_mad", k: 3, alpha: 0.2, min_history: 3 },
    pay_days_before_due: 2,
  },
  subscriptions: {
    cancel: "confirm",
    subscribe: "confirm",
    renewal_notice_days: 5,
    renew_unseen_price_increase: "allow",
    auto_cancel_trials: { enabled: true, days_before_charge: 1, notify_days_before: 3 },
  },
  savings_sweep: { enabled: true, on: "payday+1", pct: 20, keep_buffer_for_bills: true, undo_hours: 24 },
  budgets: { move_between_categories: "confirm" },
  prepaid: {
    purchase: "confirm",
    escrow_only: false,
    max_prepay: 8000,
    auto_exit_on: ["court_enforcement", "closure_notice"],
    attestation_max_age_days: 2,
    warn_on_soft_signals: true,
  },
  global: {
    daily_outflow_cap: 1000,
    per_payee_daily_cap: { SZ_POWER: 400, CHINA_MOBILE: 200 },
    expires_at: "2027-01-01T00:00:00.000Z",
  },
};

// Loose JSON for mutation; every variant is re-validated through parsePolicy.
type Draft = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Mutation = (d: Draft) => void;

function parse(input: unknown): Policy {
  const r = parsePolicy(input);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.policy;
}
const BASE = parse(BASE_INPUT);

function variant(...muts: Mutation[]): Policy {
  const d: Draft = structuredClone(BASE_INPUT);
  for (const m of muts) m(d);
  return parse(d);
}

type OrderedRow = { path: string; strict: Mutation; loose: Mutation };
const same: Mutation = () => {};

// One row per ordered field. `strict` and `loose` are applied to BASE_INPUT; strict must grant
// strictly less than loose. Moving loose -> strict is narrowing, strict -> loose is widening.
const ORDERED: OrderedRow[] = [
  { path: "fx.margin_pct", strict: (d) => (d.fx.margin_pct = 5), loose: (d) => (d.fx.margin_pct = 1) },
  { path: "payees.allow", strict: (d) => (d.payees.allow = ["SZ_POWER"]), loose: (d) => d.payees.allow.push("NEW_BILLER") },
  { path: "payees.new_payee", strict: (d) => (d.payees.new_payee = "deny"), loose: same },
  { path: "bills.auto_pay_max", strict: (d) => (d.bills.auto_pay_max = 100), loose: (d) => (d.bills.auto_pay_max = 500) },
  { path: "bills.anomaly.k", strict: (d) => (d.bills.anomaly.k = 2), loose: (d) => (d.bills.anomaly.k = 4) },
  { path: "bills.anomaly.alpha", strict: (d) => (d.bills.anomaly.alpha = 0.4), loose: (d) => (d.bills.anomaly.alpha = 0.1) },
  { path: "bills.anomaly.alpha", strict: (d) => delete d.bills.anomaly.alpha, loose: same },
  { path: "bills.anomaly.min_history", strict: (d) => (d.bills.anomaly.min_history = 5), loose: (d) => (d.bills.anomaly.min_history = 1) },
  { path: "subscriptions.cancel", strict: (d) => (d.subscriptions.cancel = "deny"), loose: same },
  { path: "subscriptions.subscribe", strict: (d) => (d.subscriptions.subscribe = "deny"), loose: same },
  {
    path: "subscriptions.renew_unseen_price_increase",
    strict: (d) => (d.subscriptions.renew_unseen_price_increase = "confirm"),
    loose: same,
  },
  {
    path: "subscriptions.auto_cancel_trials.enabled",
    strict: (d) => (d.subscriptions.auto_cancel_trials.enabled = false),
    loose: same,
  },
  { path: "savings_sweep.enabled", strict: (d) => (d.savings_sweep.enabled = false), loose: same },
  { path: "savings_sweep", strict: (d) => delete d.savings_sweep, loose: same },
  { path: "budgets.move_between_categories", strict: (d) => (d.budgets.move_between_categories = "deny"), loose: same },
  { path: "budgets", strict: (d) => delete d.budgets, loose: same },
  { path: "prepaid.purchase", strict: (d) => (d.prepaid.purchase = "deny"), loose: same },
  { path: "prepaid.escrow_only", strict: (d) => (d.prepaid.escrow_only = true), loose: same },
  { path: "prepaid.max_prepay", strict: (d) => (d.prepaid.max_prepay = 5000), loose: (d) => (d.prepaid.max_prepay = 9000) },
  { path: "prepaid.auto_exit_on", strict: (d) => (d.prepaid.auto_exit_on = ["closure_notice"]), loose: same },
  { path: "prepaid.auto_exit_on", strict: (d) => (d.prepaid.auto_exit_on = []), loose: same },
  {
    path: "prepaid.attestation_max_age_days",
    strict: (d) => (d.prepaid.attestation_max_age_days = 1),
    loose: (d) => (d.prepaid.attestation_max_age_days = 3),
  },
  { path: "global.daily_outflow_cap", strict: (d) => (d.global.daily_outflow_cap = 500), loose: (d) => (d.global.daily_outflow_cap = 2000) },
  {
    path: "global.per_payee_daily_cap.SZ_POWER",
    strict: (d) => (d.global.per_payee_daily_cap.SZ_POWER = 300),
    loose: (d) => (d.global.per_payee_daily_cap.SZ_POWER = 450),
  },
  // Adding a per-payee cap narrows; dropping one widens.
  { path: "global.per_payee_daily_cap.NEW_BILLER", strict: (d) => (d.global.per_payee_daily_cap.NEW_BILLER = 50), loose: same },
  { path: "global.per_payee_daily_cap.CHINA_MOBILE", strict: same, loose: (d) => delete d.global.per_payee_daily_cap.CHINA_MOBILE },
  {
    path: "global.expires_at",
    strict: (d) => (d.global.expires_at = "2026-12-01T00:00:00.000Z"),
    loose: (d) => (d.global.expires_at = "2027-06-01T00:00:00.000Z"),
  },
  // Absent expiry is unlimited.
  { path: "global.expires_at", strict: same, loose: (d) => delete d.global.expires_at },
];

// Fields with no order in the PRD: any change is widening, in both directions.
const UNORDERED: { path: string; x: Mutation; y: Mutation }[] = [
  { path: "bills.anomaly.method", x: same, y: (d) => (d.bills.anomaly.method = "conformal") },
  { path: "bills.pay_days_before_due", x: same, y: (d) => (d.bills.pay_days_before_due = 1) },
  { path: "bills.pay_days_before_due", x: same, y: (d) => (d.bills.pay_days_before_due = 9) },
  { path: "subscriptions.renewal_notice_days", x: same, y: (d) => (d.subscriptions.renewal_notice_days = 9) },
  { path: "subscriptions.auto_cancel_trials.days_before_charge", x: same, y: (d) => (d.subscriptions.auto_cancel_trials.days_before_charge = 2) },
  { path: "subscriptions.auto_cancel_trials.notify_days_before", x: same, y: (d) => (d.subscriptions.auto_cancel_trials.notify_days_before = 7) },
  { path: "savings_sweep.on", x: same, y: (d) => (d.savings_sweep.on = "payday+3") },
  { path: "savings_sweep.pct", x: same, y: (d) => (d.savings_sweep.pct = 10) },
  { path: "savings_sweep.keep_buffer_for_bills", x: same, y: (d) => (d.savings_sweep.keep_buffer_for_bills = false) },
  { path: "savings_sweep.undo_hours", x: same, y: (d) => (d.savings_sweep.undo_hours = 48) },
  { path: "prepaid.warn_on_soft_signals", x: same, y: (d) => (d.prepaid.warn_on_soft_signals = false) },
];

const only = (path: string, direction: FieldChange["direction"]): FieldChange[] => [{ path, direction }];

describe("compareMandates: one row per ordered field, both directions", () => {
  it.each(ORDERED.map((r, i) => [`${i} ${r.path}`, r] as const))("%s", (_name, row) => {
    const strict = variant(row.strict);
    const loose = variant(row.loose);

    const tightening = compareMandates(loose, strict);
    expect(tightening).toEqual({ relation: "narrowing", changes: only(row.path, "narrower") });
    expect(narrows(strict, loose)).toBe(true);

    const loosening = compareMandates(strict, loose);
    expect(loosening).toEqual({ relation: "widening", changes: only(row.path, "wider") });
    expect(narrows(loose, strict)).toBe(false);

    expect(equivalent(strict, loose)).toBe(false);
  });
});

describe("compareMandates: fields with no order are widening both ways", () => {
  it.each(UNORDERED.map((r, i) => [`${i} ${r.path}`, r] as const))("%s", (_name, row) => {
    const a = variant(row.x);
    const b = variant(row.y);
    expect(compareMandates(a, b)).toEqual({ relation: "widening", changes: only(row.path, "wider") });
    expect(compareMandates(b, a)).toEqual({ relation: "widening", changes: only(row.path, "wider") });
    expect(narrows(a, b)).toBe(false);
    expect(narrows(b, a)).toBe(false);
  });

  it("a savings_sweep block that was absent is widening to add, even if disabled", () => {
    const without = variant((d) => delete d.savings_sweep);
    const disabled = variant((d) => (d.savings_sweep.enabled = false));
    expect(compareMandates(without, disabled).relation).toBe("widening");
    expect(compareMandates(disabled, without).relation).toBe("narrowing");
  });
});

describe("compareMandates: other relations", () => {
  it("identical mandates are equivalent with no changes", () => {
    expect(compareMandates(BASE, variant())).toEqual({ relation: "equivalent", changes: [] });
    expect(narrows(BASE, BASE)).toBe(true);
    expect(equivalent(BASE, BASE)).toBe(true);
  });

  it("a mandate that is narrower in one field and wider in another is incomparable", () => {
    const next = variant(
      (d) => (d.bills.auto_pay_max = 100),
      (d) => (d.prepaid.max_prepay = 9000),
    );
    const r = compareMandates(BASE, next);
    expect(r.relation).toBe("incomparable");
    expect(r.changes).toEqual(
      expect.arrayContaining([
        { path: "bills.auto_pay_max", direction: "narrower" },
        { path: "prepaid.max_prepay", direction: "wider" },
      ]),
    );
    expect(narrows(next, BASE)).toBe(false);
    expect(narrows(BASE, next)).toBe(false);
  });

  it("several narrower fields together are narrowing and list every path", () => {
    const next = variant(
      (d) => (d.bills.auto_pay_max = 100),
      (d) => (d.payees.new_payee = "deny"),
      (d) => (d.global.expires_at = "2026-12-01T00:00:00.000Z"),
    );
    const r = compareMandates(BASE, next);
    expect(r.relation).toBe("narrowing");
    expect(r.changes.map((c) => c.path).sort()).toEqual(["bills.auto_pay_max", "global.expires_at", "payees.new_payee"]);
  });

  it("base_currency change is incomparable (caps are in different units)", () => {
    const eur = variant((d) => (d.base_currency = "IDR"));
    expect(compareMandates(BASE, eur)).toEqual({ relation: "incomparable", changes: only("base_currency", "incomparable") });
    expect(narrows(eur, BASE)).toBe(false);
    expect(narrows(BASE, eur)).toBe(false);
  });

  it("a set that both gains and loses members is incomparable for that field", () => {
    const next = variant((d) => (d.payees.allow = ["SZ_POWER", "OTHER"]));
    expect(compareMandates(BASE, next)).toEqual({ relation: "incomparable", changes: only("payees.allow", "incomparable") });
    expect(narrows(next, BASE)).toBe(false);
  });

  it("a method switch with a stricter k is incomparable, not narrowing", () => {
    const next = variant(
      (d) => (d.bills.anomaly.method = "conformal"),
      (d) => (d.bills.anomaly.k = 1),
    );
    expect(compareMandates(BASE, next).relation).toBe("incomparable");
    expect(narrows(next, BASE)).toBe(false);
  });

  it("an absent alpha is the strictest alpha", () => {
    const noAlpha = variant((d) => delete d.bills.anomaly.alpha);
    expect(narrows(noAlpha, BASE)).toBe(true);
    expect(narrows(BASE, noAlpha)).toBe(false);
  });

  it("narrows Lin's v3 mandate to a stricter one, not the reverse", () => {
    const lin = parse(LIN_MANDATE_V3);
    const stricter = parse({ ...LIN_MANDATE_V3, version: 4, bills: { ...LIN_MANDATE_V3.bills, auto_pay_max: 150 } });
    expect(compareMandates(lin, stricter).relation).toBe("narrowing");
    expect(compareMandates(stricter, lin).relation).toBe("widening");
  });
});

describe("equivalence ignores representation, not content", () => {
  it("ignores version, set order, duplicates, an empty per-payee map and the offset of expires_at", () => {
    const a = variant((d) => {
      d.global.per_payee_daily_cap = {};
      d.payees.allow = ["A", "B"];
    });
    const b = variant((d) => {
      d.version = 99;
      delete d.global.per_payee_daily_cap;
      d.payees.allow = ["B", "A", "A"];
      d.global.expires_at = "2026-12-31T17:00:00.000Z";
    });
    // Same everything else, but 2026-12-31T17:00Z is earlier than 2027-01-01T00:00Z.
    expect(equivalent(a, b)).toBe(false);
    expect(narrows(b, a)).toBe(true);
    const c = variant((d) => {
      d.version = 99;
      delete d.global.per_payee_daily_cap;
      d.payees.allow = ["B", "A", "A"];
      d.global.expires_at = "2027-01-01T07:00:00+07:00"; // = 2027-01-01T00:00:00Z
    });
    expect(equivalent(a, c)).toBe(true);
    expect(canonical(comparableForm(a))).toBe(canonical(comparableForm(c)));
    expect(compareMandates(a, c)).toEqual({ relation: "equivalent", changes: [] });
  });

  it("equivalent agrees with equality of the comparable form on every single-row variant", () => {
    const all = [
      ...ORDERED.flatMap((r) => [variant(r.strict), variant(r.loose)]),
      ...UNORDERED.flatMap((r) => [variant(r.x), variant(r.y)]),
    ];
    for (const p of all) {
      for (const q of all) {
        expect(equivalent(p, q)).toBe(canonical(comparableForm(p)) === canonical(comparableForm(q)));
      }
    }
  });
});

describe("order laws", () => {
  // A pool of mandates built from one or more row mutations, plus chains that narrow step by step.
  const mutationFor = fc.tuple(fc.nat(ORDERED.length - 1), fc.boolean());
  // Rows are applied in index order: a later row may delete a block an earlier one edits.
  const build = (picks: [number, boolean][]): Policy =>
    variant(...[...picks].sort((x, y) => x[0] - y[0]).map(([i, strict]) => (strict ? ORDERED[i].strict : ORDERED[i].loose)));
  const policy = fc.array(mutationFor, { maxLength: 5 }).map(build);
  const unordered = fc.nat(UNORDERED.length - 1).map((i) => variant(UNORDERED[i].y));
  const anyPolicy = fc.oneof(policy, unordered, fc.constant(BASE));

  it("is reflexive: narrows(p, p) and equivalent(p, p)", () => {
    fc.assert(
      fc.property(anyPolicy, (p) => {
        expect(narrows(p, p)).toBe(true);
        expect(equivalent(p, p)).toBe(true);
        expect(compareMandates(p, p).relation).toBe("equivalent");
      }),
      { numRuns: 300 },
    );
  });

  it("is antisymmetric: narrowing both ways means the same normalized mandate", () => {
    fc.assert(
      fc.property(anyPolicy, anyPolicy, (p, q) => {
        if (narrows(p, q) && narrows(q, p)) {
          expect(canonical(comparableForm(p))).toBe(canonical(comparableForm(q)));
          expect(equivalent(p, q)).toBe(true);
        }
        // equivalent is symmetric
        expect(equivalent(p, q)).toBe(equivalent(q, p));
      }),
      { numRuns: 500 },
    );
  });

  it("is transitive over arbitrary triples", () => {
    fc.assert(
      fc.property(anyPolicy, anyPolicy, anyPolicy, (a, b, c) => {
        if (narrows(a, b) && narrows(b, c)) expect(narrows(a, c)).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });

  it("is transitive along constructed narrowing chains (so the premise is actually exercised)", () => {
    // Strict rows applied in index order only ever move a field toward its strictest value, so each
    // growing prefix set narrows the one before it.
    const step = fc.uniqueArray(fc.nat(ORDERED.length - 1), { maxLength: 4 });
    fc.assert(
      fc.property(step, step, step, (s1, s2, s3) => {
        const at = (...sets: number[][]) =>
          variant(...[...new Set(sets.flat())].sort((x, y) => x - y).map((i) => ORDERED[i].strict));
        const [c, b, a] = [at(s1), at(s1, s2), at(s1, s2, s3)];
        expect(narrows(b, c)).toBe(true);
        expect(narrows(a, b)).toBe(true);
        expect(narrows(a, c)).toBe(true);
        // and strictly, not the other way, whenever something actually changed
        if (!equivalent(a, c)) expect(narrows(c, a)).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it("relation is consistent with narrows and equivalent", () => {
    fc.assert(
      fc.property(anyPolicy, anyPolicy, (prev, next) => {
        const { relation } = compareMandates(prev, next);
        expect(narrows(next, prev)).toBe(relation === "narrowing" || relation === "equivalent");
        expect(equivalent(prev, next)).toBe(relation === "equivalent");
        const back = compareMandates(next, prev).relation;
        if (relation === "narrowing") expect(back).toBe("widening");
        if (relation === "equivalent") expect(back).toBe("equivalent");
      }),
      { numRuns: 500 },
    );
  });
});
