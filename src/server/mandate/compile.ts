// compile(text) (architecture §9.1, §9.2): natural language -> candidate policy. R0 uses k = 1
// with structured output; the draft is re-validated with the strict zod schema (unknown fields
// rejected) and every missing field takes its most restrictive value. The compiler never
// activates anything: the user reviews the read-back and signs (src/server/mandate/activate).

import type { ModelClients } from "@/src/agent/deps";
import { MANDATE_COMPILER_SYSTEM } from "@/src/agent/prompts/mandate";
import { readback } from "./readback";
import { PolicyDraft, withDefaults, type BaseCurrency, type Policy } from "./schema";

export const MANDATE_SCHEMA_NAME = "mandate_policy_v1";
export const MAX_MANDATE_TEXT = 4000;

export type CompileResult = {
  policy: Policy;
  /** Field paths that were missing and set to their most restrictive value. */
  defaulted: string[];
  readback: string[];
};

export class MandateCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MandateCompileError";
  }
}

export async function compile(
  text: string,
  opts: { models: Pick<ModelClients, "mandate_compiler">; baseCurrency: BaseCurrency },
): Promise<CompileResult> {
  const input = text.trim();
  if (!input) throw new MandateCompileError("empty mandate text");
  if (input.length > MAX_MANDATE_TEXT) throw new MandateCompileError("mandate text too long");

  const raw = await opts.models.mandate_compiler.structured({
    role: "mandate_compiler",
    system: MANDATE_COMPILER_SYSTEM,
    input,
    schema: PolicyDraft,
    schemaName: MANDATE_SCHEMA_NAME,
  });
  // Validate again regardless of which client produced it (fail closed).
  const parsed = PolicyDraft.safeParse(raw);
  if (!parsed.success) throw new MandateCompileError("compiled policy does not match the mandate schema");

  const { policy, defaulted } = withDefaults(parsed.data, opts.baseCurrency);
  return { policy, defaulted, readback: readback(policy) };
}
