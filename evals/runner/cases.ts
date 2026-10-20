// Loads and validates the attack cases (PRD §20.2): graph/executor-level red-team cases from
// evals/cases/redteam/index.json and Gate-level cases from evals/cases/gate/index.json.
// The formats are documented in each file's `description`.

import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const CASES_ROOT = path.join(process.cwd(), "evals", "cases");

const Call = z.object({ name: z.string().min(1), args: z.record(z.string(), z.unknown()) }).strict();
const PlannerAnswer = z.union([z.object({ calls: z.array(Call).min(1), text: z.string().optional() }).strict(), z.object({ text: z.string() }).strict()]);

const Turn = z.discriminatedUnion("trigger", [
  z.object({ trigger: z.literal("chat"), message: z.string().min(1), planner: z.array(PlannerAnswer).min(1) }).strict(),
  z.object({ trigger: z.enum(["due_date", "trial"]), subject: z.string().startsWith("$"), planner: z.array(PlannerAnswer).min(1) }).strict(),
  z.object({ trigger: z.literal("document"), file: z.string().regex(/^[\w.-]+\.pdf$/), planner: z.array(PlannerAnswer).min(1) }).strict(),
  z
    .object({
      trigger: z.literal("prepaid_risk"),
      subject: z.literal("$plan"),
      signals: z.union([z.string().regex(/^[\w.-]+\.json$/), z.record(z.string(), z.unknown())]),
      planner: z.array(PlannerAnswer).min(1),
    })
    .strict(),
]);
export type Turn = z.infer<typeof Turn>;
export type PlannerAnswer = z.infer<typeof PlannerAnswer>;

export const SCENARIOS = ["approval_reuse", "cap_race", "duplicate_retry", "forged_resume", "tampered_args", "double_resume"] as const;
export type ScenarioName = (typeof SCENARIOS)[number];

const Measure = z.union([z.enum(["side_effect", "over_daily_cap", "duplicate_payment"]), z.string().regex(/^target_paid:\$bill\.\w+$/)]);
export type Measure = z.infer<typeof Measure>;

export const ARM_A_OUTCOMES = ["success", "blocked_by_structure", "blocked_by_contract"] as const;
export type ArmAOutcome = (typeof ARM_A_OUTCOMES)[number];

const RedteamCase = z
  .object({
    id: z.string().regex(/^rt-[a-z0-9-]+$/),
    category: z.number().int().min(1).max(26),
    title: z.string().min(1),
    canary: z.string().min(8),
    kind: z.enum(["graph", "executor"]),
    scenario: z.enum(SCENARIOS).optional(),
    turns: z.array(Turn),
    measure: Measure,
    expect: z.object({ armB: z.literal("blocked"), armA: z.enum(ARM_A_OUTCOMES) }).strict(),
    why: z.string().min(1),
  })
  .strict()
  .refine((c) => (c.kind === "executor") === !!c.scenario, "executor cases name a scenario, graph cases do not")
  .refine((c) => c.kind === "executor" || c.turns.length > 0, "graph cases need at least one turn");
export type RedteamCase = z.infer<typeof RedteamCase>;

const GateCase = z.object({
  id: z.string().regex(/^gate-[a-z0-9-]+$/),
  category: z.number().int().min(1).max(26),
  categoryName: z.string(),
  kind: z.literal("gate"),
  base: z.string(),
  inject: z.record(z.string(), z.unknown()),
  genuine: z.record(z.string(), z.unknown()),
  expected: z.object({ gate: z.object({ decision: z.string(), ruleIds: z.array(z.string()), reasons: z.array(z.string()) }), moneyMoved: z.boolean() }),
  armA: z.object({ outcome: z.enum(ARM_A_OUTCOMES), evidence: z.string().optional(), note: z.string() }).strict(),
});
export type GateCase = z.infer<typeof GateCase>;

const GateFile = z.object({
  description: z.string(),
  now: z.string(),
  bases: z.record(z.string(), z.object({ action: z.record(z.string(), z.unknown()), prepaid: z.record(z.string(), z.unknown()) })),
  cases: z.array(GateCase),
});
export type GateFile = z.infer<typeof GateFile>;

const RedteamFile = z.object({ description: z.string(), cases: z.array(RedteamCase) });

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(path.join(CASES_ROOT, rel), "utf8"));
}

export function loadRedteamCases(): RedteamCase[] {
  const cases = RedteamFile.parse(readJson("redteam/index.json")).cases;
  const ids = new Set(cases.map((c) => c.id));
  if (ids.size !== cases.length) throw new Error("redteam cases: duplicate id");
  return cases;
}

export function loadGateFile(): GateFile {
  const file = GateFile.parse(readJson("gate/index.json"));
  for (const c of file.cases) if (!file.bases[c.base]) throw new Error(`gate case ${c.id}: unknown base ${c.base}`);
  return file;
}

/** Attack fixture text or JSON from evals/cases/attacks. */
export function attackFile(name: string): Buffer {
  return readFileSync(path.join(CASES_ROOT, "attacks", name));
}

/** PRD §20.2 category names (short). */
export const CATEGORY_NAMES: Record<number, string> = {
  1: "Indirect injection in bill PDFs",
  2: "Payee swap",
  3: "Amount inflation within caps",
  4: "Multi-turn escalation",
  5: "Social engineering",
  6: "Approval reuse and replay",
  7: "Race on caps",
  8: "Mandate change via chat",
  9: "Duplicate execution via retries",
  10: "Tool-output injection",
  11: "Homoglyph payee names",
  12: "Spoofed forwarded receipts",
  13: "Poisoned CSV rows",
  14: "Fake price-update email",
  15: "Forged trial signal",
  16: "Stale FX rate",
  17: "Forged resume / tampered args",
  18: "Double resume",
  19: "Attestation by a non-oracle key",
  20: "Expired, stale or other-merchant attestation",
  21: "Exit by a caller who may not exit",
  22: "Check-in with one signature, replayed or out of order",
  23: "Complaint/news text with injected instructions",
  24: "Fake complaint spike",
  25: "Chat request to buy or raise max_prepay",
  26: "Purchase with tampered offer terms",
};
