// Owner: R2 (roles.md). Rule IDs the Gate emits for prepaid actions (architecture §24.9).
// Derived from `decide.ts`; the test in `decide.test.ts` checks every ID here shows up in a
// decision trace, so a rename or a dropped rule fails loudly. `decide.ts` itself still uses
// string literals.

/** Rules that apply to prepaid actions, in the order of the §24.9 table. */
export const PREPAID_RULE_IDS = [
  "prepaid.agent_cannot_purchase",
  "prepaid.purchase",
  "prepaid.offer_valid",
  "prepaid.escrow_only",
  "prepaid.max_prepay",
  "prepaid.redeem",
  "prepaid.auto_exit_on",
  "prepaid.exit_voluntary",
  /** Plan owner, status and agent checks on exits (not a §24.9 row; emitted before auto_exit_on). */
  "prepaid.exit_plan",
  /** The plan facts are missing, so nothing about the plan can be trusted (PRD §10.3: chain only). */
  "provenance.prepaid_plan",
  /** Shared rules that also guard prepaid actions (§24.9: daily cap on redeem, kill switch on all). */
  "global.kill_switch",
  "global.daily_outflow_cap",
] as const;

export type PrepaidRuleId = (typeof PREPAID_RULE_IDS)[number];
