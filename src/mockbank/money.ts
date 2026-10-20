// Owner: R3 (roles.md).
// Sweep amount validation. Account balances and transfers are numeric(14,2), so a sweep may
// carry at most 12 integer digits and 2 decimals. Validation works on the number's shortest
// decimal string (no float arithmetic), and the result is passed to Postgres as numeric text.

export const MAX_SWEEP_INTEGER_DIGITS = 12;

const SWEEP_AMOUNT = new RegExp(`^(0|[1-9]\\d{0,${MAX_SWEEP_INTEGER_DIGITS - 1}})(\\.\\d{1,2})?$`);

/**
 * The amount as numeric text if it is a finite positive number with at most two decimals that
 * fits numeric(14,2), else null. Exponent forms (1e-7, 1e21) and float artifacts such as
 * 0.30000000000000004 are rejected.
 */
export function parseSweepAmount(v: unknown): string | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  const s = String(v);
  return SWEEP_AMOUNT.test(s) ? s : null;
}
