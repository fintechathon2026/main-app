// Mandate diff and change class (architecture §9.2, PRD §9.4, §14.4). Pure. Each changed leaf is
// classed narrowing (less autonomy for the agent) or widening (more). Any widening change makes
// the whole change widening, which needs an explicit re-confirmation (passkey in R1).
// TODO(R2): move to src/core/mandate with the narrowing order and property tests.

import type { Policy } from "./schema";

export type ChangeClass = "narrowing" | "widening" | "none";
export type DiffEntry = { path: string; from: unknown; to: unknown; class: Exclude<ChangeClass, "none"> };

/** Leaf values keyed by dotted path. Arrays are leaves (compared as sets). */
function flatten(v: unknown, prefix = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) flatten(x, prefix ? `${prefix}.${k}` : k, out);
  } else if (prefix) {
    out[prefix] = v;
  }
  return out;
}

const ACT_RANK: Record<string, number> = { deny: 0, confirm: 1, allow: 2 };
// Numbers where a larger value gives the agent less room.
const LARGER_IS_NARROWER = new Set(["fx.margin_pct", "bills.anomaly.min_history", "subscriptions.renewal_notice_days", "subscriptions.auto_cancel_trials.notify_days_before"]);
// Booleans where `true` gives the agent less room.
const TRUE_IS_NARROWER = new Set(["prepaid.escrow_only", "prepaid.warn_on_soft_signals", "savings_sweep.keep_buffer_for_bills"]);

function classify(path: string, from: unknown, to: unknown): Exclude<ChangeClass, "none"> {
  if (from === undefined) return path.startsWith("global.per_payee_daily_cap.") ? "narrowing" : "widening";
  if (to === undefined) return path.startsWith("global.per_payee_daily_cap.") || path === "global.expires_at" ? "widening" : "narrowing";
  if (typeof from === "string" && typeof to === "string" && from in ACT_RANK && to in ACT_RANK) {
    return ACT_RANK[to] > ACT_RANK[from] ? "widening" : "narrowing";
  }
  if (typeof from === "number" && typeof to === "number") {
    const up = to > from;
    if (path === "bills.anomaly.alpha") return up ? "narrowing" : "widening"; // larger alpha flags more bills
    return LARGER_IS_NARROWER.has(path) ? (up ? "narrowing" : "widening") : up ? "widening" : "narrowing";
  }
  if (typeof from === "boolean" && typeof to === "boolean") {
    return TRUE_IS_NARROWER.has(path) === to ? "narrowing" : "widening";
  }
  if (Array.isArray(from) && Array.isArray(to)) {
    const added = to.some((x) => !from.includes(x));
    return added ? "widening" : "narrowing"; // allow lists and auto-exit kinds: more entries = more autonomy
  }
  if (path === "global.expires_at") return String(to) > String(from) ? "widening" : "narrowing";
  return "widening"; // unknown change: treat as the stricter path for the user (re-confirm)
}

const same = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x) => b.includes(x)) : a === b;

export function diffPolicies(from: Policy | null, to: Policy): { entries: DiffEntry[]; class: ChangeClass } {
  if (!from) return { entries: [], class: "widening" };
  const a = flatten(from);
  const b = flatten(to);
  const entries: DiffEntry[] = [];
  for (const path of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    if (path === "version" || path === "base_currency") continue;
    if (same(a[path], b[path])) continue;
    entries.push({ path, from: a[path], to: b[path], class: classify(path, a[path], b[path]) });
  }
  const cls: ChangeClass = entries.length === 0 ? "none" : entries.some((e) => e.class === "widening") ? "widening" : "narrowing";
  return { entries, class: cls };
}
