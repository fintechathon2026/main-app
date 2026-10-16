// Creates the LangGraph checkpoint tables in the "langgraph" schema (architecture §6.6).
// Run once per database over a direct or session-mode connection:
//   pnpm db:checkpointer
// Self-contained (no path aliases) so Node can run it directly with type stripping.
// Keep the schema name in sync with CHECKPOINT_SCHEMA in src/agent/checkpointer.ts.

import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL_DIRECT (or DATABASE_URL) first.");
  process.exit(1);
}

const saver = PostgresSaver.fromConnString(url, { schema: "langgraph" });
try {
  await saver.setup();
  console.log('LangGraph checkpoint tables are ready in schema "langgraph".');
} finally {
  await saver.end();
}
