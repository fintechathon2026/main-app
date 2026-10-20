// Owner: R2 (roles.md). Mandate Card data for GET /api/mandates/active and /history
// (architecture §13, §15.2). Pure. The active policy is parsed with the strict schema and its
// stored hash is re-checked, so a tampered or malformed row is an error, never a card. Change
// sentences come from a template table over the field-by-field difference of two stored
// policies; no model text (G6). History directions come from compareMandates.

import { hashPolicy } from "@/src/core/mandate/canonical";
import { compareMandates } from "@/src/core/mandate/narrow";
import { type Policy, parsePolicy } from "@/src/core/mandate/schema";
import type { MandateActiveResponse, MandateHistoryResponse, MandateVersion } from "../../api-types";

export type MandateRow = {
  version: number;
  policyJson: unknown;
  policyHash: string;
  signedAt: string;
  status: MandateVersion["status"];
  createdVia: MandateActiveResponse["createdVia"];
};

export class MandateRowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MandateRowError";
  }
}

export function buildActive(row: MandateRow): MandateActiveResponse {
  if (hashPolicy(row.policyJson) !== row.policyHash) throw new MandateRowError("stored mandate hash does not match its policy");
  const parsed = parsePolicy(row.policyJson);
  if (!parsed.ok) throw new MandateRowError(`stored mandate is not valid: ${parsed.errors.join("; ")}`);
  return { version: row.version, hash: row.policyHash, signedAt: row.signedAt, createdVia: row.createdVia, policy: parsed.policy };
}

// ---- Change sentences ----------------------------------------------------------------------

type Json = unknown;
const isObj = (v: Json): v is Record<string, Json> => !!v && typeof v === "object" && !Array.isArray(v);

/** Leaf paths ("bills.auto_pay_max") to their JSON text. Arrays are leaves. */
function leaves(v: Json, prefix = "", out = new Map<string, string>()): Map<string, string> {
  if (isObj(v)) for (const [k, x] of Object.entries(v)) leaves(x, prefix ? `${prefix}.${k}` : k, out);
  else out.set(prefix, JSON.stringify(v));
  return out;
}

const SECTION: Record<string, string> = {
  prepaid: "prepaid packages",
  savings_sweep: "moving money to savings",
  budgets: "budgets",
  subscriptions: "subscriptions",
  bills: "bills",
  payees: "payees",
  fx: "foreign currency",
  global: "limits",
};

const SYMBOL: Record<string, string> = { CNY: "¥", IDR: "Rp " };
const money = (cur: unknown, n: unknown) => `${SYMBOL[String(cur)] ?? `${String(cur)} `}${Number(n).toLocaleString("en-US")}`;

/** Sentences for fields that matter most; `from`/`to` are parsed JSON values. */
const FIELD: Record<string, (from: Json, to: Json, cur: unknown) => string> = {
  "bills.auto_pay_max": (f, t, c) => `Auto-pay limit ${Number(t) < Number(f) ? "lowered" : "raised"} from ${money(c, f)} to ${money(c, t)}`,
  "global.daily_outflow_cap": (f, t, c) => `Daily limit ${Number(t) < Number(f) ? "lowered" : "raised"} from ${money(c, f)} to ${money(c, t)}`,
  "prepaid.max_prepay": (f, t, c) => `Prepaid limit ${Number(t) < Number(f) ? "lowered" : "raised"} from ${money(c, f)} to ${money(c, t)}`,
  "payees.allow": () => "Saved payees list changed",
  "payees.new_payee": (_f, t) => (t === "deny" ? "New payees are now blocked" : "New payees now need your OK"),
  "subscriptions.cancel": (_f, t) => (t === "deny" ? "Reins can no longer cancel subscriptions" : "Cancelling a subscription now needs your OK"),
  "subscriptions.subscribe": (_f, t) => (t === "deny" ? "Reins can no longer start subscriptions" : "Starting a subscription now needs your OK"),
  "subscriptions.auto_cancel_trials.enabled": (_f, t) => (t === true ? "Free trials are now cancelled before they charge" : "Free trials are no longer cancelled automatically"),
  "prepaid.purchase": (_f, t) => (t === "deny" ? "Buying prepaid packages is now blocked" : "Buying a prepaid package now needs your OK"),
  "prepaid.escrow_only": (_f, t) => (t === true ? "Paying ahead now needs the money held safely" : "Paying ahead no longer needs the money held safely"),
  "prepaid.auto_exit_on": () => "Official notices that make Reins leave a package changed",
  "fx.margin_pct": (f, t) => `Foreign card margin changed from ${String(f)}% to ${String(t)}%`,
};

/** One sentence for what changed from `prev` to `next` (raw stored policies). */
export function describeChange(prev: Json | null, next: Json): string {
  if (prev === null) return "First rules signed";
  const a = leaves(prev);
  const b = leaves(next);
  const added = Object.keys(isObj(next) ? next : {}).filter((k) => k !== "version" && isObj(prev) && !(k in prev));
  const parts: string[] = added.map((k) => `Added rules for ${SECTION[k] ?? k.replaceAll("_", " ")}`);
  const cur = isObj(next) ? next.base_currency : undefined;
  for (const path of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    if (path === "version" || a.get(path) === b.get(path)) continue;
    if (added.includes(path.split(".")[0]!)) continue; // already covered by "Added rules for ..."
    const f = FIELD[path];
    parts.push(f ? f(parseLeaf(a.get(path)), parseLeaf(b.get(path)), cur) : `Changed ${path.replaceAll("_", " ").replaceAll(".", ": ")}`);
  }
  if (parts.length === 0) return "Rules signed again with no changes";
  const shown = parts.slice(0, 2).join("; ");
  return parts.length > 2 ? `${shown}; and ${parts.length - 2} more` : shown;
}

const parseLeaf = (s: string | undefined): Json => (s === undefined ? undefined : (JSON.parse(s) as Json));

/** Less/more permission than the previous version (compareMandates). Mixed counts as more. */
function directionOf(prev: Policy, next: Policy): MandateVersion["direction"] {
  const { relation } = compareMandates(prev, next);
  if (relation === "narrowing") return "less";
  if (relation === "equivalent") return null; // nothing changed in permission
  return "more"; // widening, or incomparable (mixed = widening, architecture §9.1)
}

/**
 * Newest first. Version 1 is "first"; every later version is compared with the one before it:
 * narrowing = "less", widening or incomparable = "more", equivalent = null.
 */
export function buildHistory(rows: MandateRow[]): MandateHistoryResponse {
  // Same integrity rules as the active card: a row whose stored hash does not match, or whose
  // policy fails the strict schema, is an error.
  const policies = new Map<number, Policy>();
  for (const r of rows) {
    if (hashPolicy(r.policyJson) !== r.policyHash) throw new MandateRowError(`stored mandate v${r.version} hash does not match its policy`);
    const parsed = parsePolicy(r.policyJson);
    if (!parsed.ok) throw new MandateRowError(`stored mandate v${r.version} is not valid: ${parsed.errors.join("; ")}`);
    policies.set(r.version, parsed.policy);
  }
  const asc = [...rows].sort((x, y) => x.version - y.version);
  return asc
    .map((r, i): MandateVersion => ({
      version: r.version,
      signedAt: r.signedAt,
      change: describeChange(i === 0 ? null : asc[i - 1]!.policyJson, r.policyJson),
      direction: i === 0 ? "first" : directionOf(policies.get(asc[i - 1]!.version)!, policies.get(r.version)!),
      status: r.status,
    }))
    .reverse();
}
