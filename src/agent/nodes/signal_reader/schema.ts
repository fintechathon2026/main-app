// Signal Reader schemas (architecture §6.3, PRD §15.12). The input bundle comes from an outside
// party (the registry simulator now, real sources later), so it is validated before use.

import { z } from "zod";

const sourceId = z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/);
const noControlChars = (s: string) => !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(s);

/** Complaint counts and news snippets for one merchant (`GET /sim/registry/signals?merchant=`). */
export const SignalBundle = z.object({
  merchantId: z.string().min(1).max(64),
  complaints: z
    .array(
      z.object({
        sourceId,
        date: z.iso.date(),
        count: z.number().int().min(0).max(1_000_000),
        text: z.string().max(2000),
      }),
    )
    .max(200),
  news: z
    .array(
      z.object({
        sourceId,
        publishedAt: z.iso.date(),
        title: z.string().max(300),
        snippet: z.string().max(2000),
        url: z.string().max(500).optional(),
      }),
    )
    .max(50),
});
export type SignalBundle = z.infer<typeof SignalBundle>;

export type SignalFetcher = (merchantId: string) => Promise<SignalBundle>;

/** Shape sent to the model as the structured-output schema. No limits here (§0.3). */
export const SignalWarningShape = z.object({
  level: z.enum(["none", "watch", "elevated"]),
  summary: z.string(),
  sourceIds: z.array(z.string()),
});

/** Strict validation applied in code to whatever the model returned. */
export const SignalWarningOutput = z.strictObject({
  level: z.enum(["none", "watch", "elevated"]),
  summary: z.string().trim().min(1).max(280).refine(noControlChars, "control characters"),
  sourceIds: z.array(z.string().max(64)).max(20),
});
export type SignalWarningOutput = z.infer<typeof SignalWarningOutput>;
