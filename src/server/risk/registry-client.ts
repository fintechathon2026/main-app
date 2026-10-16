// HTTP client for the registry's attestations (architecture §24.7). Transport only: every item
// is validated and its signature recovered by the job.

import type { RegistryClient } from "./job";

const MAX_ITEMS = 100;

export function createHttpRegistryClient(opts: {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): RegistryClient {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    async fetchAttestations(merchantId) {
      const url = new URL("/sim/registry/attestations", opts.baseUrl);
      url.searchParams.set("merchant", merchantId);
      const res = await doFetch(url, {
        headers: opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {},
        signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`attestations fetch failed: ${res.status}`);
      const body = (await res.json()) as { attestations?: unknown };
      if (!Array.isArray(body.attestations)) throw new Error("attestations fetch: bad body");
      return body.attestations.slice(0, MAX_ITEMS);
    },
  };
}
