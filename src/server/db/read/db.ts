// Shared plumbing for read repositories: a minimal query interface (so tests can pass fakes) and
// zod helpers for pg's string encodings. Dates and timestamps are selected as `::text` in SQL so
// node-postgres never turns a `date` into a local-midnight JS Date.

import { z } from "zod";
import type { Origin } from "@/src/core/types";

export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

/** numeric / bigint come back as strings. */
export const zNum = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/)]).transform((v) => Number(v));
export const zNumOrNull = zNum.nullable();

/** `date::text` → `YYYY-MM-DD`; `timestamptz::text` → ISO-like `YYYY-MM-DDTHH:MM:SS+00`. */
export const zDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/)
  .transform((s) => s.slice(0, 10));
export const zTs = z.union([z.string(), z.date()]).transform((v) => {
  if (v instanceof Date) return v.toISOString();
  const s = v.replace(" ", "T");
  const d = new Date(/T.*[+-]\d{2}$/.test(s) ? `${s}:00` : s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString();
});

export const ORIGINS = [
  "user",
  "registry",
  "mock_bank",
  "aggregator",
  "fx_provider",
  "chain",
  "oracle",
  "email",
  "document",
  "notification",
  "csv",
  "web",
  "simulated",
] as const satisfies readonly Origin[];
export const zOrigin = z.enum(ORIGINS);

export function parseRows<S extends z.ZodType>(schema: S, rows: unknown[], what: string): z.output<S>[] {
  return rows.map((r, i) => {
    const p = schema.safeParse(r);
    if (!p.success) throw new Error(`read/${what}: row ${i} failed validation: ${p.error.message}`);
    return p.data;
  });
}

export const EXPLORER_TX_BASE = "https://sepolia.basescan.org/tx/";

/** On-chain hash → explorer link; `mock:` ids (mock escrow, architecture §24.13) are simulated. */
export function chainTxRef(hash: string): { hash: string; explorerUrl: string; simulated: boolean } {
  if (hash.startsWith("mock:")) return { hash, explorerUrl: "", simulated: true };
  return { hash, explorerUrl: `${EXPLORER_TX_BASE}${hash}`, simulated: false };
}
