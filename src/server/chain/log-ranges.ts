// Owner: R3 (roles.md).
// Block-range chunking for eth_getLogs. RPC providers cap the range per request (Alchemy Free
// tier: 10 blocks, inclusive), so the indexer scans in chunks and shrinks the chunk when the
// provider rejects it. No viem and no I/O here: the fetch is a parameter, so this is unit-tested.

/** Inclusive end of the chunk that starts at `start`, at most `size` blocks, capped at `to`. */
export function chunkEnd(start: bigint, to: bigint, size: number): bigint {
  const end = start + BigInt(size) - BigInt(1);
  return end < to ? end : to;
}

/** Inclusive chunks covering [from, to] exactly once, each at most `maxRange` blocks long. */
export function logRanges(from: bigint, to: bigint, maxRange: number): [bigint, bigint][] {
  if (!Number.isInteger(maxRange) || maxRange < 1) throw new Error("maxRange must be a positive integer");
  const out: [bigint, bigint][] = [];
  for (let start = from; start <= to; ) {
    const end = chunkEnd(start, to, maxRange);
    out.push([start, end]);
    start = end + BigInt(1);
  }
  return out;
}

const RANGE_TEXT =
  /block range|range (is )?too (large|wide)|exceeds? .*range|max(imum)? (block )?range|query returned more than \d+ results/i;

/**
 * True when the provider rejected a getLogs request because of its block range. Walks the error
 * and its `.cause` chain. The JSON-RPC code alone is not enough (-32600 is any invalid request);
 * the message must say so. Rate limits (429) are not range errors.
 */
export function isLogRangeError(err: unknown): boolean {
  let e: unknown = err;
  for (let depth = 0; depth < 10 && e !== null && typeof e === "object"; depth++) {
    const o = e as { message?: unknown; details?: unknown; shortMessage?: unknown; cause?: unknown };
    for (const text of [o.message, o.details, o.shortMessage]) if (typeof text === "string" && RANGE_TEXT.test(text)) return true;
    e = o.cause;
  }
  return false;
}

/** Text of an error and its causes, for the provider's suggested range. */
function errorText(err: unknown): string {
  const parts: string[] = [];
  let e: unknown = err;
  for (let depth = 0; depth < 10 && e !== null && typeof e === "object"; depth++) {
    const o = e as { message?: unknown; details?: unknown; cause?: unknown };
    for (const text of [o.message, o.details]) if (typeof text === "string") parts.push(text);
    e = o.cause;
  }
  return parts.join("\n");
}

/**
 * Next chunk size after a range error: the provider's hint ("this block range should work:
 * [0x0, 0x9]" means 10 blocks) when there is one, else half. Always smaller than `current`
 * (so the scan makes progress towards 1) and never below 1.
 */
export function shrinkLogRange(current: number, err: unknown): number {
  const hint = /\[\s*0x([0-9a-f]+)\s*,\s*0x([0-9a-f]+)\s*\]/i.exec(errorText(err));
  let next = Math.floor(current / 2);
  if (hint) {
    const size = Number(BigInt("0x" + hint[2]) - BigInt("0x" + hint[1]) + BigInt(1));
    if (Number.isSafeInteger(size) && size >= 1) next = Math.min(size, current - 1);
  }
  return Math.max(1, next);
}

export type ScanLogRangesOptions<T> = {
  from: bigint;
  to: bigint;
  /** Starting chunk size in blocks (inclusive bounds). */
  maxRange: number;
  /** Fetches the logs of [start, end], both inclusive. */
  fetch: (start: bigint, end: bigint) => Promise<T[]>;
  /** Pause between successful requests, for rate-limited providers. Default 0. */
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Fetches every block of [from, to] exactly once, in order. `start` only advances past a chunk
 * that was fetched, so there are no gaps and no overlaps. On a range error the same chunk is
 * retried smaller; the smaller size is kept for the rest of the scan and returned. Any other
 * error, or a range error at size 1, is rethrown.
 */
export async function scanLogRanges<T>(opts: ScanLogRangesOptions<T>): Promise<{ items: T[]; maxRange: number }> {
  const { from, to, fetch } = opts;
  let size = opts.maxRange;
  if (!Number.isInteger(size) || size < 1) throw new Error("maxRange must be a positive integer");
  const delayMs = opts.delayMs ?? 0;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const items: T[] = [];
  let first = true;
  for (let start = from; start <= to; ) {
    const end = chunkEnd(start, to, size);
    if (!first && delayMs > 0) await sleep(delayMs);
    let got: T[];
    try {
      got = await fetch(start, end);
    } catch (err) {
      if (size > 1 && isLogRangeError(err)) {
        size = shrinkLogRange(size, err);
        continue;
      }
      throw err;
    }
    first = false;
    items.push(...got);
    start = end + BigInt(1);
  }
  return { items, maxRange: size };
}
