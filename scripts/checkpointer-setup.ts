// Creates the LangGraph checkpoint tables in the "langgraph" schema (architecture §6.6).
// Run once per database over a direct or session-mode connection with an admin role (setup()
// needs database-level CREATE; the app role reins_server gets table access through the
// default privileges in migration 20261017000009):
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
  // Tables that existed before the default privileges were set still need the grant.
  const { Client } = await import("pg");
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await c.query("grant select, insert, update, delete on all tables in schema langgraph to reins_server");
  } finally {
    await c.end();
  }
  console.log('LangGraph checkpoint tables are ready in schema "langgraph".');
} finally {
  await saver.end();
}
