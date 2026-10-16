// PII tokenization before any LLM call (architecture §10.2, PRD T6). R0: regex-based.
// Replaces account numbers, phone numbers, Chinese resident IDs, Indonesian NIKs, emails and
// wallet addresses with stable tokens like ⟦ACCT_1⟧. The returned map (token -> raw value)
// must never be sent to a model; it stays server-side (Postgres when persisted).

export type PiiKind = "EMAIL" | "PHONE" | "CNID" | "NIK" | "ADDR" | "ACCT";

/** token -> raw value as it first appeared in the text. */
export type PiiMap = Record<string, string>;

export type RedactResult = { text: string; map: PiiMap };

const TOKEN_OPEN = "⟦";
const TOKEN_CLOSE = "⟧";

/** Matches tokens produced by this module, e.g. ⟦ACCT_3⟧. */
export const PII_TOKEN_RE = /⟦(EMAIL|PHONE|CNID|NIK|ADDR|ACCT)_(\d+)⟧/g;

type Rule = { kind: PiiKind; re: RegExp; accept?: (m: string) => PiiKind | null };

const digitsOf = (s: string) => s.replace(/\D/g, "");

/**
 * Indonesian NIK: 16 digits, province code 11-94, birth date DDMMYY at positions 7-12 where
 * women add 40 to the day. Anything else that is 16 digits is treated as an account number.
 */
function isPlausibleNik(d: string): boolean {
  if (d.length !== 16) return false;
  const prov = Number(d.slice(0, 2));
  let day = Number(d.slice(6, 8));
  const month = Number(d.slice(8, 10));
  if (day > 40) day -= 40;
  return prov >= 11 && prov <= 94 && day >= 1 && day <= 31 && month >= 1 && month <= 12;
}

// Order matters: specific patterns run before the generic digit-run rule, and every rule runs
// on text where earlier matches are already tokens.
const RULES: Rule[] = [
  { kind: "EMAIL", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  // EVM-style addresses and other long hex strings (wallets are routing data, never for the LLM).
  { kind: "ADDR", re: /\b0x[0-9a-fA-F]{8,}\b/g },
  // +86 mobile: +86 138 0013 8000, +86-13800138000, +8613800138000
  { kind: "PHONE", re: /\+86[ -]?1[3-9]\d(?:[ -]?\d{4}){2}(?!\d)/g },
  // +62 mobile: +62 812 3456 7890, +62-812-3456-789, +6281234567890
  { kind: "PHONE", re: /\+62[ -]?8\d{1,3}(?:[ -]?\d{3,4}){2,3}(?!\d)/g },
  // Local mobile numbers: CN 1[3-9]x xxxx xxxx, ID 08xx-xxxx-xxxx
  { kind: "PHONE", re: /(?<![\d+])1[3-9]\d(?:[ -]?\d{4}){2}(?!\d)/g },
  { kind: "PHONE", re: /(?<![\d+])08\d{2}(?:[ -]?\d{3,4}){2}(?!\d)/g },
  // Chinese resident ID: 17 digits + check digit (digit or X).
  { kind: "CNID", re: /(?<![\dA-Za-z])\d{17}[\dXx](?![\dA-Za-z])/g },
  // 16-digit run: NIK when structurally plausible, else an account/card number.
  {
    kind: "NIK",
    re: /(?<!\d)\d{16}(?!\d)/g,
    accept: (m) => (isPlausibleNik(m) ? "NIK" : "ACCT"),
  },
  // Generic account numbers: digit runs of 8+ digits, optionally grouped by single spaces or
  // dashes in groups of 3+ (6222 0212 3456 7890, 8812-3344-5566). Dates (2026-10-15) do not
  // match because their groups are shorter. Amounts with a decimal fraction are left alone.
  {
    kind: "ACCT",
    re: /(?<![\d.,])\d{3,}(?:[ -]\d{3,})*(?![\d]|[.,]\d)/g,
    accept: (m) => (digitsOf(m).length >= 8 ? "ACCT" : null),
  },
];

function normalizeKey(kind: PiiKind, raw: string): string {
  if (kind === "EMAIL" || kind === "ADDR") return `${kind}:${raw.toLowerCase()}`;
  // Phone numbers: compare by national digits so "+86 138..." and "138..." share a token.
  let d = digitsOf(raw);
  if (kind === "PHONE") {
    if (raw.trim().startsWith("+86")) d = d.slice(2);
    else if (raw.trim().startsWith("+62")) d = `0${d.slice(2)}`;
  }
  return `${kind === "CNID" ? `CNID:${raw.toUpperCase()}` : `DIGITS:${d}`}`;
}

/**
 * Tokenize PII in `text`. Pass a previous `map` to keep tokens stable across several texts
 * (for example all snippets for one merchant). Existing ⟦ and ⟧ characters in the input are
 * neutralized first so untrusted text cannot forge a token.
 */
export function redactPii(text: string, prior?: PiiMap): RedactResult {
  const map: PiiMap = { ...(prior ?? {}) };
  const byKey = new Map<string, string>();
  const counters: Record<PiiKind, number> = { EMAIL: 0, PHONE: 0, CNID: 0, NIK: 0, ADDR: 0, ACCT: 0 };
  for (const [token, raw] of Object.entries(map)) {
    const m = /^⟦([A-Z]+)_(\d+)⟧$/.exec(token);
    if (!m) continue;
    const kind = m[1] as PiiKind;
    counters[kind] = Math.max(counters[kind], Number(m[2]));
    byKey.set(normalizeKey(kind, raw), token);
  }

  let out = text.replace(/⟦/g, "[").replace(/⟧/g, "]");

  for (const rule of RULES) {
    out = out.replace(rule.re, (match) => {
      const kind = rule.accept ? rule.accept(match) : rule.kind;
      if (!kind) return match;
      const key = normalizeKey(kind, match);
      let token = byKey.get(key);
      if (!token) {
        counters[kind] += 1;
        token = `${TOKEN_OPEN}${kind}_${counters[kind]}${TOKEN_CLOSE}`;
        byKey.set(key, token);
        map[token] = match;
      }
      return token;
    });
  }
  return { text: out, map };
}

/** True when `text` still contains something the redactor would replace. */
export function containsPii(text: string): boolean {
  const { map } = redactPii(text);
  return Object.keys(map).length > 0;
}
