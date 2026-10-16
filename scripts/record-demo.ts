// Records the model calls of the demo path (task.md §9) into evals/recordings/<scenario>/ so the
// demo, CI and the e2e tests replay them through RecordedModelClient (architecture §6.5, §18.3).
//
//   set -a; . ./.env.local; set +a
//   node --no-warnings --experimental-transform-types scripts/record-demo.ts            # hand-written answers
//   REINS_MODELS=recording ANTHROPIC_API_KEY=... node --no-warnings \
//     --experimental-transform-types scripts/record-demo.ts                            # live models
//
// Options: --scenario <name> (default demo_lin).
//
// It drives the real graph, Postgres plan store, executor, Gate and the in-process mock bank for
// the seeded persona Lin, so every request is byte-for-byte what the app builds. Needs local
// Supabase with the seed (`pnpm exec supabase db reset`). Lin's touched rows are restored
// before each flow and at the end. Details: evals/README.md.
//
// Runs on plain Node (type stripping + transform) with a small resolve hook for the "@/" alias
// and extensionless relative imports, so it needs no extra dependency.

import { register } from "node:module";

const hooks = `
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
const ROOT = ${JSON.stringify(new URL("../", import.meta.url).href)};
const isFile = (u) => { const p = fileURLToPath(u); return existsSync(p) && statSync(p).isFile(); };
export async function resolve(spec, ctx, next) {
  let base = null;
  if (spec.startsWith("@/")) base = new URL(spec.slice(2), ROOT).href;
  else if ((spec.startsWith("./") || spec.startsWith("../")) && ctx.parentURL?.startsWith(ROOT) && !ctx.parentURL.includes("/node_modules/")) {
    base = new URL(spec, ctx.parentURL).href;
  }
  if (base) for (const c of [base, base + ".ts", base + "/index.ts"]) if (isFile(c)) return next(c, ctx);
  return next(spec, ctx);
}`;
register("data:text/javascript," + encodeURIComponent(hooks), import.meta.url);

const { main } = await import("./record-demo-main");
await main(process.argv.slice(2));
