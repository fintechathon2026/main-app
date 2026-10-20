// Owner: R3 (roles.md). getLogs range chunking: chunks cover [from, to] once with inclusive
// bounds, range errors shrink the chunk (Alchemy Free tier: 10 blocks), other errors propagate.

import { describe, expect, it, vi } from "vitest";
import { InvalidRequestRpcError, RpcRequestError } from "viem";
import { chunkEnd, isLogRangeError, logRanges, scanLogRanges, shrinkLogRange } from "./log-ranges";

const ALCHEMY_MESSAGE =
  "Under the Free tier plan, you can make eth_getLogs requests with up to a 10 block range. Based on your parameters, this block range should work: [0x0, 0x9]. Upgrade to PAYG for expanded block range.";
const alchemyError = () =>
  new InvalidRequestRpcError(new RpcRequestError({ body: {}, url: "x", error: { code: -32600, message: ALCHEMY_MESSAGE } }));

function expectCovers(ranges: [bigint, bigint][], from: bigint, to: bigint, maxRange: number) {
  expect(ranges[0][0]).toBe(from);
  expect(ranges[ranges.length - 1][1]).toBe(to);
  for (let i = 0; i < ranges.length; i++) {
    const [start, end] = ranges[i];
    expect(end >= start).toBe(true);
    expect(end - start + BigInt(1) <= BigInt(maxRange)).toBe(true);
    if (i > 0) expect(start).toBe(ranges[i - 1][1] + BigInt(1));
  }
}

describe("logRanges", () => {
  it("uses inclusive bounds", () => {
    expect(chunkEnd(BigInt(0), BigInt(100), 10)).toBe(BigInt(9));
    expect(chunkEnd(BigInt(95), BigInt(100), 10)).toBe(BigInt(100));
    expect(logRanges(BigInt(0), BigInt(9), 10)).toEqual([[BigInt(0), BigInt(9)]]);
    expect(logRanges(BigInt(0), BigInt(10), 10)).toEqual([
      [BigInt(0), BigInt(9)],
      [BigInt(10), BigInt(10)],
    ]);
    expect(logRanges(BigInt(5), BigInt(5), 10)).toEqual([[BigInt(5), BigInt(5)]]);
    expect(logRanges(BigInt(6), BigInt(5), 10)).toEqual([]);
  });

  it("rejects a size below 1", () => {
    expect(() => logRanges(BigInt(0), BigInt(9), 0)).toThrow();
    expect(() => logRanges(BigInt(0), BigInt(9), 1.5)).toThrow();
  });

  it("covers every block once, without gaps or overlaps", () => {
    const deploy = BigInt(48356082);
    const cases: [bigint, bigint, number][] = [
      [BigInt(0), BigInt(1999), 2000],
      [BigInt(0), BigInt(2000), 2000],
      [BigInt(1), BigInt(1), 1],
      [BigInt(3), BigInt(77), 1],
      [BigInt(7), BigInt(123), 10],
      [deploy, deploy + BigInt(1234), 10],
      [deploy, deploy + BigInt(1234), 2000],
    ];
    for (const [from, to, max] of cases) {
      const ranges = logRanges(from, to, max);
      expectCovers(ranges, from, to, max);
      const blocks = ranges.reduce((n, [s, e]) => n + (e - s + BigInt(1)), BigInt(0));
      expect(blocks).toBe(to - from + BigInt(1));
    }
  });
});

describe("isLogRangeError", () => {
  it("matches the Alchemy Free tier error as viem throws it", () => {
    expect(isLogRangeError(alchemyError())).toBe(true);
  });

  it("matches a plain error with a range message in its cause", () => {
    expect(isLogRangeError({ cause: { code: -32600, message: "eth_getLogs block range too large" } })).toBe(true);
  });

  it("does not match rate limits, other invalid requests or nothing", () => {
    expect(isLogRangeError({ message: "Too Many Requests" })).toBe(false);
    expect(isLogRangeError({ code: -32600, message: "JSON is not a valid request object." })).toBe(false);
    expect(isLogRangeError(null)).toBe(false);
    expect(isLogRangeError(undefined)).toBe(false);
  });
});

describe("shrinkLogRange", () => {
  it("uses the provider's suggested range", () => {
    expect(shrinkLogRange(2000, alchemyError())).toBe(10);
  });

  it("halves without a hint", () => {
    expect(shrinkLogRange(2000, new Error("block range too large"))).toBe(1000);
    expect(shrinkLogRange(3, new Error("block range too large"))).toBe(1);
  });

  it("never goes below 1 and always shrinks", () => {
    expect(shrinkLogRange(1, alchemyError())).toBe(1);
    expect(shrinkLogRange(1, new Error("block range too large"))).toBe(1);
    expect(shrinkLogRange(5, alchemyError())).toBe(4);
  });
});

describe("scanLogRanges", () => {
  const limited = (limit: number) => {
    const calls: [bigint, bigint][] = [];
    const fetch = async (start: bigint, end: bigint) => {
      if (end - start + BigInt(1) > BigInt(limit)) throw alchemyError();
      calls.push([start, end]);
      return [start, end];
    };
    return { calls, fetch };
  };

  it("shrinks to the provider limit and covers the range exactly once", async () => {
    const { calls, fetch } = limited(10);
    const from = BigInt(100);
    const to = BigInt(1234);
    const r = await scanLogRanges({ from, to, maxRange: 2000, fetch });
    expect(calls).toEqual(logRanges(from, to, 10));
    expect(r.maxRange).toBe(10);
    expect(r.items).toEqual(calls.flat());
  });

  it("keeps the size when the provider accepts it", async () => {
    const { calls, fetch } = limited(2000);
    const r = await scanLogRanges({ from: BigInt(0), to: BigInt(4500), maxRange: 2000, fetch });
    expect(calls).toEqual(logRanges(BigInt(0), BigInt(4500), 2000));
    expect(r.maxRange).toBe(2000);
  });

  it("does nothing for an empty range", async () => {
    const fetch = vi.fn(async () => [] as number[]);
    const r = await scanLogRanges({ from: BigInt(6), to: BigInt(5), maxRange: 10, fetch });
    expect(fetch).not.toHaveBeenCalled();
    expect(r).toEqual({ items: [], maxRange: 10 });
  });

  it("rethrows any other error without further calls", async () => {
    const boom = new Error("Too Many Requests");
    const fetch = vi.fn(async () => {
      throw boom;
    });
    await expect(scanLogRanges({ from: BigInt(0), to: BigInt(100), maxRange: 10, fetch })).rejects.toBe(boom);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rethrows a range error once the size is 1", async () => {
    const sizes: bigint[] = [];
    const fetch = async (start: bigint, end: bigint): Promise<number[]> => {
      sizes.push(end - start + BigInt(1));
      throw new Error("block range too large");
    };
    await expect(scanLogRanges({ from: BigInt(0), to: BigInt(100), maxRange: 8, fetch })).rejects.toThrow("block range too large");
    expect(sizes).toEqual([BigInt(8), BigInt(4), BigInt(2), BigInt(1)]);
  });

  it("sleeps between successful requests only when asked", async () => {
    const sleep = vi.fn(async () => {});
    const { fetch } = limited(10);
    await scanLogRanges({ from: BigInt(0), to: BigInt(29), maxRange: 10, fetch, delayMs: 5, sleep });
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(5);

    const quiet = vi.fn(async () => {});
    await scanLogRanges({ from: BigInt(0), to: BigInt(29), maxRange: 10, fetch, sleep: quiet });
    expect(quiet).not.toHaveBeenCalled();
  });
});
