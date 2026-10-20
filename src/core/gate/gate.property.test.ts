// Property tests (fast-check) for the guarantees that sit between the mandate and the Gate:
//   (a) narrowing monotonicity (PRD §9.5 theorem; architecture §7.3, §24.9): if p' narrows p, then
//       for every action and snapshot, decide() under p' is never more permissive than under p;
//   (b) canonicalization: idempotent and independent of key order (PRD §9.1).
// Policies are generated as plain objects and always go through parsePolicy.

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { canonical, hashPolicy } from "../mandate/canonical";
import { narrows } from "../mandate/narrow";
import { parsePolicy, type Policy } from "../mandate/schema";
import type { Decision, GateSnapshot, Origin, PrepaidFacts, TypedAction } from "../types";
import { decide } from "./decide";

const NOW = "2026-10-20T00:00:00.000Z";
const DAY = 86_400_000;
const NOW_MS = Date.parse(NOW);
const OWNER = "0x1111111111111111111111111111111111111111";
const OTHER = "0x9999999999999999999999999999999999999999";
const RANK: Record<Decision, number> = { allow: 0, require_confirm: 1, deny: 2 };

const BILLERS = ["A", "B", "C", "D"] as const;
const MARGINS = [0, 1, 2.5, 3, 5, 10, 25, 50] as const;
const ALPHAS = [0.05, 0.1, 0.2, 0.3, 0.5, 0.9] as const;
const EXPIRIES = [NOW_MS - DAY, NOW_MS + DAY, NOW_MS + 30 * DAY].map((ms) => new Date(ms).toISOString());
const KINDS = ["court_enforcement", "closure_notice"] as const;
const CONFIRM_ORDER = ["deny", "confirm"] as const;
const PRICE_ORDER = ["confirm", "allow"] as const;

function parse(input: unknown): Policy {
  const r = parsePolicy(input);
  if (!r.ok) throw new Error(`generated policy rejected: ${r.errors.join("; ")}`);
  return r.policy;
}

// ---- policies ------------------------------------------------------------------------------

const optional = <T>(a: fc.Arbitrary<T>) => fc.oneof(fc.constant(undefined), a);

/** `base` is the bill amount the scenario revolves around; thresholds are drawn near it too. */
const rawPolicy = (base: number) => fc.record({
  version: fc.constant(5),
  base_currency: fc.constant("CNY" as const),
  fx: fc.record({ rate_source: fc.constant("ecb_reference" as const), margin_pct: fc.constantFrom(...MARGINS) }),
  payees: fc.record({ allow: fc.subarray([...BILLERS]), new_payee: fc.constantFrom(...CONFIRM_ORDER) }),
  bills: fc.record({
    auto_pay_max: fc.oneof(fc.integer({ min: 0, max: 600 }), fc.integer({ min: base - 20, max: base * 2 + 20 })),
    anomaly: fc.record({
      method: fc.constantFrom("median_mad" as const, "conformal" as const),
      k: fc.constantFrom(0, 1, 2, 3, 5),
      alpha: optional(fc.constantFrom(...ALPHAS)),
      min_history: fc.integer({ min: 0, max: 6 }),
    }),
    pay_days_before_due: fc.constant(2),
  }),
  subscriptions: fc.record({
    cancel: fc.constantFrom("confirm" as const, "confirm" as const, "confirm" as const, "deny" as const),
    subscribe: fc.constantFrom(...CONFIRM_ORDER),
    renewal_notice_days: fc.constant(5),
    renew_unseen_price_increase: fc.constantFrom(...PRICE_ORDER),
    auto_cancel_trials: fc.record({
      enabled: fc.boolean(),
      days_before_charge: fc.constant(1),
      notify_days_before: fc.constant(3),
    }),
  }),
  savings_sweep: optional(
    fc.record({
      enabled: fc.boolean(),
      on: fc.constant("payday+1"),
      pct: fc.constantFrom(10, 20),
      keep_buffer_for_bills: fc.boolean(),
      undo_hours: fc.constant(24),
    }),
  ),
  budgets: optional(fc.record({ move_between_categories: fc.constantFrom(...CONFIRM_ORDER) })),
  prepaid: fc.record({
    purchase: fc.constantFrom("confirm" as const, "confirm" as const, "confirm" as const, "deny" as const),
    escrow_only: fc.boolean(),
    max_prepay: fc.integer({ min: 0, max: 10_000 }),
    auto_exit_on: fc.subarray([...KINDS]),
    attestation_max_age_days: fc.integer({ min: 0, max: 5 }),
    warn_on_soft_signals: fc.boolean(),
  }),
  global: fc.record({
    daily_outflow_cap: fc.oneof(fc.integer({ min: 0, max: 2000 }), fc.integer({ min: base, max: base * 3 })),
    per_payee_daily_cap: optional(
      fc
        .tuple(fc.subarray([...BILLERS]), fc.array(fc.integer({ min: 0, max: 800 }), { minLength: 4, maxLength: 4 }))
        .map(([keys, caps]) => Object.fromEntries(keys.map((k, i) => [k, caps[i]]))),
    ),
    expires_at: optional(fc.constantFrom(...EXPIRIES)),
  }),
});

/** Plain objects fast-check built may carry `undefined` values; drop them as JSON would. */
const clean = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const policyFor = (base: number): fc.Arbitrary<Policy> => rawPolicy(base).map((r) => parse(clean(r)));
const policyArb = policyFor(250);

// ---- narrowings of a given policy ---------------------------------------------------------

const atMost = (n: number) => fc.oneof(fc.constant(n), fc.integer({ min: 0, max: n }));
const atLeast = (n: number, span: number) => fc.oneof(fc.constant(n), fc.integer({ min: n, max: n + span }));
const upTo = <T>(order: readonly T[], v: T) => fc.constantFrom(...order.slice(0, order.indexOf(v) + 1));

function narrowingOf(p: Policy): fc.Arbitrary<Policy> {
  const caps = p.global.per_payee_daily_cap ?? {};
  const capKeys = Object.keys(caps);
  const newKeys = BILLERS.filter((b) => !(b in caps));
  const a = p.bills.anomaly;
  const sweep = p.savings_sweep;
  return fc
    .record({
      margin: fc.constantFrom(...MARGINS.filter((m) => m >= p.fx.margin_pct)),
      allow: fc.subarray(p.payees.allow),
      newPayee: upTo(CONFIRM_ORDER, p.payees.new_payee),
      autoPay: atMost(p.bills.auto_pay_max),
      k: atMost(a.k),
      alpha: a.alpha === undefined ? fc.constant(undefined) : fc.constantFrom(...ALPHAS.filter((x) => x >= a.alpha!), undefined),
      minHistory: atLeast(a.min_history, 3),
      cancel: upTo(CONFIRM_ORDER, p.subscriptions.cancel),
      subscribe: upTo(CONFIRM_ORDER, p.subscriptions.subscribe),
      renew: upTo(PRICE_ORDER, p.subscriptions.renew_unseen_price_increase),
      autoCancel: p.subscriptions.auto_cancel_trials.enabled ? fc.boolean() : fc.constant(false),
      sweep: sweep ? optional(fc.record({ enabled: sweep.enabled ? fc.boolean() : fc.constant(false) })) : fc.constant(undefined),
      budgets: p.budgets
        ? optional(fc.record({ move_between_categories: upTo(CONFIRM_ORDER, p.budgets.move_between_categories) }))
        : fc.constant(undefined),
      purchase: upTo(CONFIRM_ORDER, p.prepaid.purchase),
      escrowOnly: p.prepaid.escrow_only ? fc.constant(true) : fc.boolean(),
      maxPrepay: atMost(p.prepaid.max_prepay),
      autoExit: fc.subarray(p.prepaid.auto_exit_on),
      attAge: atMost(p.prepaid.attestation_max_age_days),
      dailyCap: atMost(p.global.daily_outflow_cap),
      existingCaps: fc.tuple(...capKeys.map((k) => atMost(caps[k]))),
      addedCaps: fc.tuple(fc.subarray(newKeys), fc.array(fc.integer({ min: 0, max: 800 }), { minLength: 4, maxLength: 4 })),
      expires: p.global.expires_at
        ? fc.constantFrom(...EXPIRIES.filter((e) => Date.parse(e) <= Date.parse(p.global.expires_at!)))
        : optional(fc.constantFrom(...EXPIRIES)),
    })
    .map((c) => {
      const perPayee =
        capKeys.length === 0 && c.addedCaps[0].length === 0 && p.global.per_payee_daily_cap === undefined
          ? undefined
          : {
              ...Object.fromEntries(capKeys.map((k, i) => [k, c.existingCaps[i]])),
              ...Object.fromEntries(c.addedCaps[0].map((k, i) => [k, c.addedCaps[1][i]])),
            };
      return parse(
        clean({
          ...p,
          fx: { ...p.fx, margin_pct: c.margin },
          payees: { allow: c.allow, new_payee: c.newPayee },
          bills: { ...p.bills, auto_pay_max: c.autoPay, anomaly: { ...a, k: c.k, alpha: c.alpha, min_history: c.minHistory } },
          subscriptions: {
            ...p.subscriptions,
            cancel: c.cancel,
            subscribe: c.subscribe,
            renew_unseen_price_increase: c.renew,
            auto_cancel_trials: { ...p.subscriptions.auto_cancel_trials, enabled: c.autoCancel },
          },
          savings_sweep: sweep && c.sweep ? { ...sweep, enabled: c.sweep.enabled } : undefined,
          budgets: c.budgets,
          prepaid: {
            ...p.prepaid,
            purchase: c.purchase,
            escrow_only: c.escrowOnly,
            max_prepay: c.maxPrepay,
            auto_exit_on: c.autoExit,
            attestation_max_age_days: c.attAge,
          },
          global: { ...p.global, daily_outflow_cap: c.dailyCap, per_payee_daily_cap: perPayee, expires_at: c.expires },
        }),
      );
    });
}

// ---- actions and snapshots ------------------------------------------------------------------

const likely = fc.constantFrom(true, true, true, false);
const mostly = fc.constantFrom(true, true, true, true, true, false);
/** A fact that is almost always the good value, so multi-condition rules are reached often. */
const nearly = fc.constantFrom(true, true, true, true, true, true, true, true, true, true, false);
const biller = fc.constantFrom(...BILLERS, "Z");

/** `base` is the bill amount the scenario revolves around, so history and amount agree. */
const near = (base: number, spread: number) =>
  fc.integer({ min: -spread, max: spread }).map((d) => Math.max(1, base + d));

type ToolKey = TypedAction["tool"] | "prepaid_purchase_by_agent";

const actionsFor = (p: Policy, base: number): Record<ToolKey, fc.Arbitrary<TypedAction>> => {
  const billers =
    p.payees.allow.length > 0
      ? fc.oneof({ weight: 5, arbitrary: fc.constantFrom(...p.payees.allow) }, { weight: 1, arbitrary: biller })
      : biller;
  return {
    pay_bill: fc.tuple(billers, near(base, 12)).map(
      ([biller_id, amount]): TypedAction => ({ tool: "pay_bill", actor: "agent", args: { bill_id: "bill", biller_id, amount } }),
    ),
    cancel_subscription: fc.constant({ tool: "cancel_subscription", actor: "agent", args: { subscription_id: "sub" } }),
    sweep_to_savings: near(base, 30).map(
      (amount): TypedAction => ({ tool: "sweep_to_savings", actor: "agent", args: { amount } }),
    ),
    prepaid_exit: fc.constant({ tool: "prepaid_exit", actor: "agent", args: { plan_id: "plan" } }),
    prepaid_purchase: fc.constant({ tool: "prepaid_purchase", actor: "user", args: { offer_id: "offer" } }),
    // Not a valid TypedAction by type: it is the forged input the Gate must always deny.
    prepaid_purchase_by_agent: fc.constant({
      tool: "prepaid_purchase",
      actor: "agent",
      args: { offer_id: "offer" },
    } as unknown as TypedAction),
    prepaid_redeem: fc.integer({ min: 1, max: 3 }).map(
      (session_no): TypedAction => ({ tool: "prepaid_redeem", actor: "user", args: { plan_id: "plan", session_no } }),
    ),
    prepaid_exit_voluntary: fc.constant({ tool: "prepaid_exit_voluntary", actor: "user", args: { plan_id: "plan" } }),
  };
};

const TOOLS: ToolKey[] = [
  "pay_bill",
  "cancel_subscription",
  "sweep_to_savings",
  "prepaid_exit",
  "prepaid_purchase",
  "prepaid_purchase_by_agent",
  "prepaid_redeem",
  "prepaid_exit_voluntary",
];

const actionFor = (p: Policy, base: number, only?: ToolKey): fc.Arbitrary<TypedAction> => {
  const all = actionsFor(p, base);
  if (only) return all[only];
  return fc.oneof(...TOOLS.map((t) => ({ weight: t === "pay_bill" ? 6 : t === "prepaid_purchase" ? 3 : 1, arbitrary: all[t] })));
};

/** Facts are drawn around the policy's own thresholds so prepaid fields actually decide outcomes. */
const prepaidFor = (p: Policy): fc.Arbitrary<PrepaidFacts> =>
  fc.record({
    actor: fc.constantFrom("agent" as const, "user" as const, "user" as const, "user" as const, "user" as const, "user" as const),
    ownerWallet: fc.constantFrom<string | null>(...Array<string | null>(11).fill(OWNER), null),
    plan: fc.oneof(
      { weight: 1, arbitrary: fc.constant(null) },
      {
        weight: 12,
        arbitrary: fc.record({
          owner: fc.constantFrom(...Array(11).fill(OWNER), OTHER),
          merchant: fc.constant("0xmerchant"),
          agent: fc.constant<string | null>("0xagent"),
          status: fc.constantFrom(
            ...Array(10).fill("active" as const),
            "completed" as const,
            "exited_attested" as const,
          ),
          unitPrice: fc.integer({ min: 1, max: 800 }),
          unitsLeft: fc.integer({ min: 0, max: 10 }),
          nextSession: fc.integer({ min: 1, max: 3 }),
        }),
      },
    ),
    offer: optional(
      fc.record({
        merchantSigValid: nearly,
        expired: nearly.map((b) => !b),
        termsMatchStored: nearly,
        escrowSupported: fc.boolean(),
        totalBase: fc.integer({ min: 0, max: p.prepaid.max_prepay + 200 }),
      }),
    ),
    consumerSigValid: fc.constantFrom<boolean | undefined>(...Array(10).fill(true), undefined, false),
    merchantSigValid: fc.constantFrom<boolean | undefined>(...Array(10).fill(true), undefined, false),
    sessionNo: optional(fc.integer({ min: 1, max: 3 })),
    attestation: fc.oneof(
      { weight: 1, arbitrary: fc.constant(null) },
      {
        weight: 12,
        arbitrary: fc.record({
          signerIsOracle: nearly,
          kind: fc.constantFrom(...KINDS),
          merchantMatches: nearly,
          ageDays: fc.integer({ min: -1, max: p.prepaid.attestation_max_age_days + 1 }),
          expired: nearly.map((b) => !b),
        }),
      },
    ),
    agentIsOurs: fc.constantFrom<boolean | undefined>(...Array(10).fill(true), undefined, false),
  });

const amountOrigin = fc.constantFrom<Origin | null>("mock_bank", "aggregator", "document", "email", "web", null);

const snapshotFor = (p: Policy, action: TypedAction, base: number): fc.Arbitrary<Omit<GateSnapshot, "mandate">> =>
  fc.record({
    now: fc.constant(NOW),
    killSwitch: fc.constantFrom(...Array(24).fill(false), true),
    provenance: fc.record({
      destinationOrigin: fc.constantFrom<Origin | null>(...Array<Origin>(10).fill("registry"), "email", null),
      amountOrigin,
      amountMatchesBill: nearly,
    }),
    payee: fc.oneof(
      {
        weight: 6,
        arbitrary: fc.record({
          billerId: fc.constant(action.tool === "pay_bill" ? action.args.biller_id : "A"),
          inRegistry: mostly,
          verified: mostly,
        }),
      },
      { weight: 1, arbitrary: fc.constant(null) },
      { weight: 1, arbitrary: fc.record({ billerId: biller, inRegistry: likely, verified: likely }) },
    ),
    history: fc.record({
      amounts: fc.array(fc.integer({ min: -6, max: 6 }).map((d) => Math.max(0, base + d)), { maxLength: 8 }),
    }),
    fx: fc.oneof(
      { weight: 3, arbitrary: fc.constant(null) },
      {
        weight: 2,
        arbitrary: fc.record({
          rate: fc.constantFrom(0.14, 0.5, 1, 2),
          date: fc.constantFrom(0, 1, 2, 3).map((d) => new Date(NOW_MS - d * DAY).toISOString()),
          source: fc.constant("fx_provider" as const),
        }),
      },
    ),
    caps: fc.record({
      dailyUsed: fc.integer({ min: 0, max: 700 }),
      dailyCap: fc.integer({ min: 0, max: 2500 }),
      perPayeeUsed: optional(fc.integer({ min: 0, max: 700 })),
      perPayeeCap: optional(fc.integer({ min: 0, max: 900 })),
    }),
    approval: fc.oneof(
      { weight: 3, arbitrary: fc.constant(null) },
      { weight: 1, arbitrary: fc.record({ valid: fc.boolean(), reason: fc.constant("test") }) },
    ),
    subscription: fc.oneof({ weight: 1, arbitrary: fc.constant(undefined) }, { weight: 6, arbitrary:
      fc.record({
        status: fc.constantFrom(...Array(9).fill("active"), "cancelled"),
        isTrial: fc.constantFrom(true, true, true, false),
        trialOrigin: fc.constantFrom<Origin | null>(...Array<Origin>(9).fill("mock_bank"), "email", null),
        keepFlag: fc.constantFrom(...Array(9).fill(false), true),
        noticeSent: nearly,
      }) }),
    prepaid: fc.oneof({ weight: 1, arbitrary: fc.constant(undefined) }, { weight: 5, arbitrary: prepaidFor(p) }),
  }) as fc.Arbitrary<Omit<GateSnapshot, "mandate">>;

type Scenario = { p: Policy; narrowed: Policy; snap: Omit<GateSnapshot, "mandate">; action: TypedAction };

const scenarioFor = (only?: ToolKey): fc.Arbitrary<Scenario> =>
  fc.integer({ min: 20, max: 500 }).chain((base) =>
    policyFor(base)
      .chain((p) => narrowingOf(p).map((narrowed) => ({ p, narrowed })))
      .chain(({ p, narrowed }) =>
        actionFor(p, base, only).chain((action) =>
          snapshotFor(p, action, base).map((snap) => ({ p, narrowed, action, snap: clean(snap) })),
        ),
      ),
  );
const scenarioArb = scenarioFor();

function under(s: Scenario, policy: Policy): Decision {
  const snap: GateSnapshot = {
    ...s.snap,
    mandate: { version: policy.version, hash: "h", policy, signatureValid: true },
  };
  return decide(s.action, snap).decision;
}

/** The theorem: narrowing never makes the Gate more permissive. */
function monotone(s: Scenario): void {
  expect(narrows(s.narrowed, s.p)).toBe(true); // the generator and narrows() agree
  const before = under(s, s.p);
  const after = under(s, s.narrowed);
  expect(RANK[after], `${s.action.tool}: ${before} -> ${after}`).toBeGreaterThanOrEqual(RANK[before]);
}

/**
 * FINDING 1 lives in a conformal mandate whose alpha moves to another defined value. Everything
 * else (including dropping alpha, and alpha under median_mad where it is unused) stays checked.
 */
const alphaMovesUnderConformal = (s: Scenario) => {
  const before = s.p.bills.anomaly;
  const after = s.narrowed.bills.anomaly;
  return before.method === "conformal" && after.alpha !== undefined && after.alpha !== before.alpha;
};

// ---- (a) narrowing monotonicity -------------------------------------------------------------

describe("narrowing monotonicity: decide(p') is never more permissive than decide(p)", () => {
  it("holds for every field except alpha under conformal (mixed tools, prepaid fields included)", () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        fc.pre(!alphaMovesUnderConformal(s));
        monotone(s);
      }),
      { numRuns: 4000 },
    );
  });

  // The rules behind each tool need several facts to line up before they can say "allow", so each
  // tool also gets its own run with facts biased toward passing: otherwise a field that only
  // matters on the allow path is almost never exercised.
  it.each(TOOLS)("holds per tool: %s", (tool) => {
    fc.assert(
      fc.property(scenarioFor(tool), (s) => {
        fc.pre(!alphaMovesUnderConformal(s));
        monotone(s);
      }),
      { numRuns: tool === "pay_bill" ? 8000 : 3000 },
    );
  });

  // FINDING 1 (reported, not fixed): PRD §9.5 orders `alpha` as "p'.alpha >= p.alpha narrows", but
  // conformalCheck (anomaly.ts) fails closed with `insufficient_history` whenever
  // ceil((n+1)(1-alpha)) > n, i.e. alpha < 1/(n+1). A LARGER alpha can therefore be MORE permissive.
  // Minimal case: method conformal, history [100,100,100], pay 100: alpha 0.2 -> rank 4 > n=3 ->
  // require_confirm; alpha 0.3 -> rank 3 -> q=0, |x-m|=0 -> allow. This is the full property
  // (alpha not pinned) and it must fail until the order or conformalCheck is fixed; `it.fails`
  // keeps CI green and turns red the moment it is fixed, so the marker gets removed.
  it.fails("FINDING 1: holds for alpha too (conformal boundary alpha < 1/(n+1))", () => {
    const p = parse({
      version: 5,
      base_currency: "CNY",
      payees: { allow: ["A"], new_payee: "deny" },
      bills: { auto_pay_max: 300, anomaly: { method: "conformal", k: 3, alpha: 0.2, min_history: 3 } },
      global: { daily_outflow_cap: 1000 },
    });
    const narrowed = parse({ ...p, bills: { ...p.bills, anomaly: { ...p.bills.anomaly, alpha: 0.3 } } });
    const witness: Scenario = {
      p,
      narrowed,
      action: { tool: "pay_bill", actor: "agent", args: { bill_id: "bill", biller_id: "A", amount: 100 } },
      snap: {
        now: NOW,
        killSwitch: false,
        provenance: { destinationOrigin: "registry", amountOrigin: "mock_bank", amountMatchesBill: true },
        payee: { billerId: "A", inRegistry: true, verified: true },
        history: { amounts: [100, 100, 100] },
        fx: null,
        caps: { dailyUsed: 0, dailyCap: 1000 },
        approval: null,
      },
    };
    fc.assert(
      fc.property(scenarioArb, (s) => monotone(s)),
      { numRuns: 4000, examples: [[witness]] },
    );
  });

  it("is not vacuous: every tool is sometimes allowed, and narrowing sometimes strictly tightens", () => {
    const seen = new Map<string, { allowed: number; tightened: number }>();
    for (const s of fc.sample(scenarioArb, { numRuns: 6000, seed: 20261020 })) {
      const before = under(s, s.p);
      const after = under(s, s.narrowed);
      const row = seen.get(s.action.tool) ?? { allowed: 0, tightened: 0 };
      if (before === "allow") row.allowed++;
      if (RANK[after] > RANK[before]) row.tightened++;
      seen.set(s.action.tool, row);
    }
    const tools: TypedAction["tool"][] = [
      "pay_bill",
      "cancel_subscription",
      "sweep_to_savings",
      "prepaid_exit",
      "prepaid_purchase",
      "prepaid_redeem",
      "prepaid_exit_voluntary",
    ];
    for (const t of tools) expect(seen.get(t), t).toBeDefined();
    // The tools whose outcome depends on the policy must show both effects.
    for (const t of ["pay_bill", "cancel_subscription", "prepaid_exit", "prepaid_purchase"] as const) {
      expect(seen.get(t)!.allowed, `${t} allowed`).toBeGreaterThan(0);
      expect(seen.get(t)!.tightened, `${t} tightened`).toBeGreaterThan(0);
    }
  });

  it("covers each prepaid field: tightening it alone flips a prepaid decision", () => {
    const base = {
      version: 5,
      base_currency: "CNY",
      prepaid: {
        purchase: "confirm",
        escrow_only: false,
        max_prepay: 1000,
        auto_exit_on: ["court_enforcement"],
        attestation_max_age_days: 3,
        warn_on_soft_signals: true,
      },
      global: { daily_outflow_cap: 1000 },
    };
    const prepaid = (over: Record<string, unknown>) => parse({ ...base, prepaid: { ...base.prepaid, ...over } });
    const purchaseSnap = (s: Partial<NonNullable<GateSnapshot["prepaid"]>> = {}): Omit<GateSnapshot, "mandate"> => ({
      now: NOW,
      killSwitch: false,
      provenance: { destinationOrigin: "registry", amountOrigin: "mock_bank", amountMatchesBill: true },
      payee: null,
      history: { amounts: [] },
      fx: null,
      caps: { dailyUsed: 0, dailyCap: 1000 },
      approval: null,
      prepaid: {
        actor: "user",
        ownerWallet: OWNER,
        plan: { owner: OWNER, merchant: "m", agent: "a", status: "active", unitPrice: 10, unitsLeft: 5, nextSession: 1 },
        offer: { merchantSigValid: true, expired: false, termsMatchStored: true, escrowSupported: false, totalBase: 800 },
        consumerSigValid: true,
        merchantSigValid: true,
        agentIsOurs: true,
        attestation: { signerIsOracle: true, kind: "court_enforcement", merchantMatches: true, ageDays: 2, expired: false },
        ...s,
      },
    });
    const purchase: TypedAction = { tool: "prepaid_purchase", actor: "user", args: { offer_id: "o" } };
    const exit: TypedAction = { tool: "prepaid_exit", actor: "agent", args: { plan_id: "p" } };
    const rows: [string, TypedAction, Policy, Policy][] = [
      ["purchase confirm->deny", purchase, prepaid({}), prepaid({ purchase: "deny" })],
      ["escrow_only false->true", purchase, prepaid({}), prepaid({ escrow_only: true })],
      ["max_prepay lowered", purchase, prepaid({}), prepaid({ max_prepay: 500 })],
      ["auto_exit_on shrunk", exit, prepaid({}), prepaid({ auto_exit_on: [] })],
      ["attestation_max_age_days lowered", exit, prepaid({}), prepaid({ attestation_max_age_days: 1 })],
    ];
    for (const [name, action, wide, tight] of rows) {
      expect(narrows(tight, wide), name).toBe(true);
      const s = { p: wide, narrowed: tight, snap: purchaseSnap(), action } as Scenario;
      expect(RANK[under(s, tight)], name).toBeGreaterThan(RANK[under(s, wide)]);
    }
  });
});

// ---- (b) canonicalization --------------------------------------------------------------------

/** Deterministic key shuffle (mulberry32), applied at every depth. */
function shuffleKeys(value: unknown, seed: number): unknown {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const entries = Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)] as const);
      for (let i = entries.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [entries[i], entries[j]] = [entries[j], entries[i]];
      }
      return Object.fromEntries(entries);
    }
    return v;
  };
  return walk(value);
}

describe("canonicalization (PRD §9.1)", () => {
  it("is idempotent: canonical(parse(canonical(x))) === canonical(x), hashes included", () => {
    fc.assert(
      fc.property(policyArb, (p) => {
        const once = canonical(p);
        expect(canonical(JSON.parse(once))).toBe(once);
        expect(hashPolicy(JSON.parse(once))).toBe(hashPolicy(p));
      }),
      { numRuns: 1000 },
    );
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        const once = canonical(v);
        expect(canonical(JSON.parse(once))).toBe(once);
      }),
      { numRuns: 1000 },
    );
  });

  it("does not depend on key order, at any depth", () => {
    fc.assert(
      fc.property(policyArb, fc.integer(), (p, seed) => {
        const shuffled = shuffleKeys(p, seed);
        expect(canonical(shuffled)).toBe(canonical(p));
        expect(hashPolicy(shuffled)).toBe(hashPolicy(p));
        // and re-parsing the shuffled authoring form lands on the same hash
        const reparsed = parsePolicy(shuffled);
        expect(reparsed.ok && hashPolicy(reparsed.policy)).toBe(hashPolicy(p));
      }),
      { numRuns: 1000 },
    );
    fc.assert(
      fc.property(fc.jsonValue(), fc.integer(), (v, seed) => {
        expect(canonical(shuffleKeys(v, seed))).toBe(canonical(v));
      }),
      { numRuns: 1000 },
    );
  });

  it("hashes equal exactly when canonical forms are equal, and array order is significant", () => {
    fc.assert(
      fc.property(policyArb, policyArb, (p, q) => {
        const same = canonical(p) === canonical(q);
        expect(hashPolicy(p) === hashPolicy(q)).toBe(same);
      }),
      { numRuns: 500 },
    );
    expect(canonical([1, 2])).not.toBe(canonical([2, 1]));
  });
});
