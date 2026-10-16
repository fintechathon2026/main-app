// Helper to declare a read tool: strict zod args, JSON Schema derived from the same schema, and
// the user id taken from ToolContext only (architecture §6.4: never from LLM arguments).

import { z } from "zod";
import type { ReadRepos } from "@/src/server/db/read/repos";
import type { ViewDeps } from "@/src/server/db/read/views";
import type { ReadTool, ToolContext } from "../types";

export type ToolDeps = { repos: ReadRepos };

export function defineReadTool<S extends z.ZodObject, R>(def: {
  name: string;
  description: string;
  args: S;
  run: (args: z.output<S>, d: ViewDeps) => Promise<R>;
}): (deps: ToolDeps) => ReadTool<z.output<S>, unknown> {
  const inputSchema = z.toJSONSchema(def.args) as Record<string, unknown>;
  return (deps) => ({
    spec: { name: def.name, description: def.description, inputSchema },
    argsSchema: def.args as unknown as z.ZodType<z.output<S>>,
    async run(args: z.output<S>, ctx: ToolContext) {
      // Re-validate: the graph may hand over raw LLM arguments.
      const parsed = def.args.parse(args);
      return def.run(parsed, { repos: deps.repos, userId: ctx.userId, now: ctx.now });
    },
  });
}

export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
export const zId = z.string().min(1).max(128);
export const zCurrency = z.string().regex(/^[A-Z]{3}$/, "ISO 4217 code");
