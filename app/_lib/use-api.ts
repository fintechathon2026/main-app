"use client";

// Minimal polling fetch hook (architecture §15.1: client updates via polling in R0). No data
// library: screens read a handful of routes and only approvals need refresh.

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiRequestError } from "./api";

export type ApiState<T> = {
  data: T | null;
  error: ApiRequestError | Error | null;
  loading: boolean;
  reload: () => void;
};

export function useApi<T>(path: string | null, opts?: { pollMs?: number }): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const first = useRef(true);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    if (first.current) setLoading(true);
    apiFetch<T>(path)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e: Error) => !cancelled && setError(e))
      .finally(() => {
        if (cancelled) return;
        first.current = false;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, tick]);

  useEffect(() => {
    if (!path || !opts?.pollMs) return;
    const id = setInterval(reload, opts.pollMs);
    return () => clearInterval(id);
  }, [path, opts?.pollMs, reload]);

  return { data, error, loading, reload };
}
