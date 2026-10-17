// HTTP fetcher for the registry simulator's soft signals (architecture §24.7). The response is
// validated by the Signal Reader against `SignalBundle`; this only does transport.

import type { SignalBundle, SignalFetcher } from "./schema";

export function createHttpSignalFetcher(opts: {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): SignalFetcher {
  const doFetch = opts.fetchImpl ?? fetch;
  return async (merchantId) => {
    const url = new URL("/sim/registry/signals", opts.baseUrl);
    url.searchParams.set("merchant", merchantId);
    const res = await doFetch(url, {
      headers: opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {},
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`signals fetch failed: ${res.status}`);
    return (await res.json()) as SignalBundle;
  };
}
