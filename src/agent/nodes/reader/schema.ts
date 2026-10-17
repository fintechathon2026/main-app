// Reader output schemas (architecture §6.3, PRD §12.2).
// Two schemas on purpose: structured outputs cannot express numeric ranges or string lengths
// (architecture §0.3), so the model gets the plain shape and zod enforces the limits after.

import { z } from "zod";

/** Shape sent to the model as the structured-output schema. No limits here. */
export const BillExtractionShape = z.object({
  biller_name: z.string(),
  amount: z.number(),
  currency: z.string(),
  due_date: z.string(),
  period: z.string(),
  account_number: z.string().nullable().optional(),
  suspicious_text: z.boolean(),
});
export type BillExtractionShape = z.infer<typeof BillExtractionShape>;

const noControlChars = (s: string) => !/[\u0000-\u001f\u007f]/.test(s);

/** Strict validation applied in code to whatever the model returned. */
export const BillExtraction = z.strictObject({
  biller_name: z.string().trim().min(1).max(120).refine(noControlChars, "control characters"),
  amount: z
    .number()
    .positive()
    .max(100_000_000_000)
    .refine((n) => Number.isFinite(n) && Math.round(n * 100) / 100 === n, "at most two decimals"),
  currency: z.string().regex(/^[A-Z]{3}$/),
  due_date: z.iso.date(),
  period: z.string().trim().min(1).max(40).regex(/^[0-9A-Za-z ./:-]+$/),
  account_number: z
    .string()
    .trim()
    .max(64)
    .regex(/^(⟦[A-Z]+_\d+⟧|[0-9A-Za-z -]+)$/)
    .nullable()
    .optional(),
  suspicious_text: z.boolean(),
});
export type BillExtraction = z.infer<typeof BillExtraction>;

export type BillFieldName = keyof BillExtraction;

/** One extracted field. The Planner sees these only inside `Labeled` with origin=document. */
export type ReaderField = { field: BillFieldName; value: string | number | boolean };
