"use client";

// Client data loading for the screens. Reads a UI route; when the route is not reachable yet
// (no session, not built, offline) and a sample is given, shows the sample and says so on
// screen. Samples are never used for actions: buttons always call the real route.

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

export type Loaded<T> =
  | { state: "loading" }
  | { state: "error"; message: string; retry: () => void }
  | { state: "ready"; data: T; sample: boolean; reload: () => void };

export function useApi<T>(url: string | null, sample?: T): Loaded<T> {
  const [result, setResult] = useState<{ data: T; sample: boolean } | { error: string } | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!url) return;
    let alive = true;
    fetch(url, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as T;
      })
      .then((data) => alive && setResult({ data, sample: false }))
      .catch((e: Error) => {
        if (!alive) return;
        setResult(sample !== undefined ? { data: sample, sample: true } : { error: e.message });
      });
    return () => {
      alive = false;
    };
    // `sample` is a static import; including it would refetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, tick]);

  if (!result) return { state: "loading" };
  if ("error" in result) return { state: "error", message: result.error, retry: reload };
  return { state: "ready", data: result.data, sample: result.sample, reload };
}

export type PostResult<T> = { ok: true; data: T } | { ok: false; status: number; code?: string };

export async function postJson<T>(url: string, body?: unknown): Promise<PostResult<T>> {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!r.ok) {
      const err = (await r.json().catch(() => ({}))) as { code?: string };
      return { ok: false, status: r.status, code: err.code };
    }
    return { ok: true, data: (await r.json()) as T };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** Current time. Null while prerendering, so the server never reads the clock (cacheComponents). */
let nowValue: Date | null = null;
function subscribeNow(cb: () => void) {
  const t = setInterval(() => {
    nowValue = new Date();
    cb();
  }, 60_000);
  return () => clearInterval(t);
}
const getNow = () => (nowValue ??= new Date());
const getServerNow = () => null;

export function useNow(): Date | null {
  return useSyncExternalStore(subscribeNow, getNow, getServerNow);
}
