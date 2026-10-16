// Number extraction for post-checks (PRD T5, architecture §6.7): user-visible LLM text may only
// contain numbers that came from tools or audit rows.

const NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g;

/** All numbers in `text`, normalized ("1,250,000" -> "1250000", "3.50" -> "3.5"). */
export function extractNumbers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.match(NUMBER_RE) ?? []) {
    const n = Number(m.replace(/,/g, ""));
    if (Number.isFinite(n)) out.push(String(n));
  }
  return out;
}

/** True when every number in `candidate` appears among the numbers of `sources`. */
export function numbersSubsetOf(candidate: string, sources: string[]): boolean {
  const allowed = new Set(sources.flatMap(extractNumbers));
  return extractNumbers(candidate).every((n) => allowed.has(n));
}

/** True when both texts contain exactly the same numbers (as multisets). */
export function sameNumbers(a: string, b: string): boolean {
  const x = extractNumbers(a).sort();
  const y = extractNumbers(b).sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}
