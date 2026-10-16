// Read-tool contract (architecture §6.4). Read tools are side-effect free and receive the
// userId from server-set graph config, never from LLM arguments.

import type { z } from "zod";
import type { Labeled } from "@/src/core/types";
import type { ToolSpec } from "../models/types";

export type ToolContext = { userId: string; now: string };

export interface ReadTool<A = Record<string, unknown>, R = unknown> {
  spec: ToolSpec;
  argsSchema: z.ZodType<A>;
  run(args: A, ctx: ToolContext): Promise<Labeled<R> | Labeled<R>[] | R>;
}
