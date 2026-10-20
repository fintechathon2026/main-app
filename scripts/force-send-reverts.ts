// Force-sent on-chain reverts for the red-team evidence (R2-11, architecture §24.5). Sends three
// attack transactions against one active plan with simulation skipped, so each is mined as a
// reverted transaction with its hash in chain_txs: a forged attestation exit, a merchant-only
// check-in and an out-of-order check-in. Spends test gas; moves no money.
//
//   set -a; . ./.env.local; set +a
//   EVAL_FORCE_SEND_REVERTS=1 node --no-warnings --experimental-transform-types \
//     scripts/force-send-reverts.ts --plan <chainPlanId> --user <userId> --confirm
//
// Uses the chain config from the environment (CHAIN_ID, RPC, ESCROW_ADDRESS, relayer and agent
// keys). Refuses in a deployed environment (NODE_ENV=production or VERCEL_ENV). The same code
// runs on a private anvil in tests/chain/force-send.test.ts. Body: force-send-reverts-main.ts.

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

const { main } = await import("./force-send-reverts-main");
await main(process.argv.slice(2));
