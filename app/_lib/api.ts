// Browser-side API client for the UI (R4). Auth rides on the Supabase session cookie; in local
// demo mode (REINS_DEMO_AUTH=1 on the server, never in production) the demo user id from
// NEXT_PUBLIC_REINS_DEMO_USER is sent as `x-demo-user`. The server decides who the user is.

import type { ApiError } from "@/src/server/api-types";

const DEMO_USER = process.env.NEXT_PUBLIC_REINS_DEMO_USER;

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

export function apiHeaders(extra?: HeadersInit): Headers {
  const h = new Headers(extra);
  if (DEMO_USER) h.set("x-demo-user", DEMO_USER);
  return h;
}

export async function apiFetch<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const headers = apiHeaders(init?.headers);
  let body = init?.body;
  if (init?.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  const res = await fetch(path, { ...init, headers, body, cache: "no-store" });
  if (!res.ok) {
    let err: ApiError | null = null;
    try {
      err = (await res.json()) as ApiError;
    } catch {
      // non-JSON error body
    }
    throw new ApiRequestError(res.status, err?.code, err?.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}
