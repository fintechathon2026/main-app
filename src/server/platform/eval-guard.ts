// I-04 (task.md, architecture §16.3): the eval-only switch that turns the Policy Gate off
// (`REINS_EVAL_DISABLE_GATE`, arm A of the experiment) must never be honoured in production.
// This module only refuses to start; the switch itself is not implemented anywhere.

type Env = Readonly<Record<string, string | undefined>>;

const FALSY = new Set(["", "0", "false", "no", "off"]);

/** Any value other than empty / 0 / false / no / off counts as set (fail closed on odd values). */
function isTruthy(v: string | undefined): boolean {
  return v !== undefined && !FALSY.has(v.trim().toLowerCase());
}

/**
 * Throws when REINS_EVAL_DISABLE_GATE is set and the process looks like production:
 * NODE_ENV === "production" or any VERCEL_ENV (production, preview or development on Vercel).
 */
export function assertGateNotDisabled(env: Env): void {
  if (!isTruthy(env.REINS_EVAL_DISABLE_GATE)) return;
  const prod = env.NODE_ENV === "production";
  const vercel = !!env.VERCEL_ENV;
  if (prod || vercel) {
    throw new Error(
      `REINS_EVAL_DISABLE_GATE is set in a deployed environment (${prod ? "NODE_ENV=production" : `VERCEL_ENV=${env.VERCEL_ENV}`}). ` +
        "The Policy Gate cannot be disabled outside eval builds (G1, I-04). Unset it.",
    );
  }
}
