// Puts Lin's FitBox package on chain for the demo (PRD_PrepaidEscrow_Contract §9 step 6):
// mints tCNY to Lin's demo consumer key, buys 60 × ¥100 from the merchant simulator's signed
// offer, checks in 12 sessions, points Lin's wallet and FitBox's chain address at the real keys,
// removes the seeded mock plan and runs chain-sync once. After this, publishing an attestation
// (POST /sim/registry/publish) and running cron/risk lets the agent exit on chain.
//
//   set -a; . ./.env.local; set +a
//   DEMO_CONSUMER_PRIVATE_KEY=0x... node --no-warnings --experimental-transform-types scripts/chain-demo-setup.ts
//
// Needs: CHAIN_ID, BASE_SEPOLIA_RPC_URL, ESCROW_ADDRESS, TOKEN_ADDRESS, AGENT_ADDRESS,
// TOKEN_MINTER_PRIVATE_KEY, RELAYER_PRIVATE_KEY, MERCHANT_SIM_PRIVATE_KEY, DEMO_CONSUMER_PRIVATE_KEY,
// DATABASE_URL (reins_server) and DATABASE_URL_DIRECT (admin, for the demo rows).
// DEMO_CONSUMER_PRIVATE_KEY stands in for Lin's browser key on a dev machine. Never put it on the
// server or in Vercel. Same resolve hook as scripts/record-demo.ts for the "@/" alias.

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

const { main } = await import("./chain-demo-setup-main");
await main();
