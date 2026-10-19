// Owner: R3 (roles.md).
// Pure CSV / JSONL serializers for log exports (PRD FR10.4). No I/O, no clock, no env.

/** One JSON object per line, with a trailing newline (empty string for no rows). */
export function toJsonl(rows: Record<string, unknown>[]): string {
  return rows.map((r) => JSON.stringify(r) + "\n").join("");
}

// A spreadsheet treats cells starting with these as formulas (CSV injection).
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s: string;
  if (typeof v === "string") s = v;
  else if (v instanceof Date) s = v.toISOString();
  else if (typeof v === "object") s = JSON.stringify(v);
  else s = String(v);
  if (typeof v === "string" && FORMULA_START.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180 CSV: header row, CRLF line endings, cells quoted only when needed. */
export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const lines = [columns.map(cell), ...rows.map((r) => columns.map((c) => cell(r[c])))];
  return lines.map((l) => l.join(",") + "\r\n").join("");
}
