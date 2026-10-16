// LangGraph checkpointer (architecture §6.6, PRD §11.6.3). Checkpoints live in their own
// "langgraph" schema, which Supabase's Data API does not expose. setup() (which creates the
// tables) runs only from `pnpm db:checkpointer` (scripts/checkpointer-setup.ts), never at
// request time. Tests use MemorySaver instead.

import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

export const CHECKPOINT_SCHEMA = "langgraph";

let saver: PostgresSaver | null = null;

export function checkpointerConnString(env: Record<string, string | undefined> = process.env): string {
  const url = env.DATABASE_URL_DIRECT || env.DATABASE_URL;
  if (!url) throw new Error("checkpointer: set DATABASE_URL_DIRECT (or DATABASE_URL)");
  return url;
}

/** Process-wide PostgresSaver. Does not call setup(). */
export function getCheckpointer(): PostgresSaver {
  if (!saver) saver = PostgresSaver.fromConnString(checkpointerConnString(), { schema: CHECKPOINT_SCHEMA });
  return saver;
}
