// Body of scripts/chain-demo-setup.ts (kept separate so the resolve hook is registered before any
// "@/" import is evaluated). See that file for usage.

import { Pool } from "pg";
import { createWalletClient, http, parseSignature, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { PREPAID_ESCROW_ABI, TEST_CNY_ABI } from "@/src/server/chain/abi";
import { chainConfigFromEnv, chainFor, publicClientFor, readChainPlan } from "@/src/server/chain/client";
import { PERMIT_TYPES, PURCHASE_AUTH_TYPES, REDEEM_TYPES, escrowDomain, tokenDomain } from "@/src/server/chain/eip712";
import { runChainSync } from "@/src/server/chain/indexer";
import { getPool } from "@/src/server/db/pool";
import { currentOffers, signCheckin } from "@/src/sim/merchant/merchant";

const LIN = "11111111-1111-4111-8111-111111111111";
const SESSIONS_USED = 12;
const LOCAL_ANVIL = 31337;

function key(name: string): Hex {
  const v = process.env[name]?.trim();
  if (!v || !/^0x[0-9a-fA-F]{64}$/.test(v)) throw new Error(`${name} is not set`);
  return v as Hex;
}

export async function main(): Promise<void> {
  const chain = chainConfigFromEnv();
  if (!chain || !chain.tokenAddress) throw new Error("Set ESCROW_ADDRESS, TOKEN_ADDRESS and BASE_SEPOLIA_RPC_URL (see contracts/deployments)");
  const agent = process.env.AGENT_ADDRESS as Address | undefined;
  if (!agent) throw new Error("Set AGENT_ADDRESS (the address of AGENT_PRIVATE_KEY)");
  const adminUrl = process.env.DATABASE_URL_DIRECT;
  if (!adminUrl) throw new Error("Set DATABASE_URL_DIRECT (admin connection for the demo rows)");

  const client = publicClientFor(chain);
  const viemChain = chainFor(chain.chainId, chain.rpcUrls[0]);
  const consumer = privateKeyToAccount(key("DEMO_CONSUMER_PRIVATE_KEY"));
  const relayer = createWalletClient({ chain: viemChain, transport: http(chain.rpcUrls[0]), account: privateKeyToAccount(key("RELAYER_PRIVATE_KEY")) });
  const minter = createWalletClient({ chain: viemChain, transport: http(chain.rpcUrls[0]), account: privateKeyToAccount(key("TOKEN_MINTER_PRIVATE_KEY")) });
  const send = async (label: string, hash: Hex) => {
    const r = await client.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`${label} reverted (${hash})`);
    console.log(`  ${label.padEnd(18)} ${hash}`);
  };

  // 1. The merchant simulator's signed FitBox offer.
  const fitbox = (await currentOffers()).find((o) => o.merchantId === "FITBOX_FUTIAN");
  if (!fitbox?.merchantSig || !fitbox.offerHash) throw new Error("merchant simulator returned no signed FitBox offer (MERCHANT_SIM_PRIVATE_KEY?)");
  const offer = {
    merchant: fitbox.offer.merchant as Address,
    unitPrice: BigInt(fitbox.offer.unitPrice),
    units: fitbox.offer.units,
    cancelFeeBps: fitbox.offer.cancelFeeBps,
    expiresAt: BigInt(fitbox.offer.expiresAt),
    nonce: BigInt(fitbox.offer.nonce),
  };
  const total = offer.unitPrice * BigInt(offer.units);
  console.log(`FitBox offer: ${offer.units} × ${offer.unitPrice} fen, merchant ${offer.merchant}`);

  // 2. Load Lin's wallet (demo faucet).
  const balance = await client.readContract({ address: chain.tokenAddress, abi: TEST_CNY_ABI, functionName: "balanceOf", args: [consumer.address] });
  if (balance < total) {
    await send("mint", await minter.writeContract({ address: chain.tokenAddress, abi: TEST_CNY_ABI, functionName: "mint", args: [consumer.address, total - balance] }));
  }

  // 3. Lin signs the purchase (agent = Reins) and the permit; the relayer submits.
  const domain = escrowDomain({ chainId: chain.chainId, escrowAddress: chain.escrowAddress });
  const now = BigInt(Math.floor(Date.now() / 1000));
  const auth = { offerHash: fitbox.offerHash, consumer: consumer.address, agent, deadline: now + BigInt(3600) };
  const consumerSig = await consumer.signTypedData({ domain, types: PURCHASE_AUTH_TYPES, primaryType: "PurchaseAuth", message: auth });
  const nonce = await client.readContract({ address: chain.tokenAddress, abi: TEST_CNY_ABI, functionName: "nonces", args: [consumer.address] });
  const permitSig = await consumer.signTypedData({
    domain: tokenDomain({ chainId: chain.chainId, tokenAddress: chain.tokenAddress }),
    types: PERMIT_TYPES,
    primaryType: "Permit",
    message: { owner: consumer.address, spender: chain.escrowAddress, value: total, nonce, deadline: now + BigInt(3600) },
  });
  const { r, s, v, yParity } = parseSignature(permitSig);
  const permit = { value: total, deadline: now + BigInt(3600), v: Number(v ?? BigInt(yParity + 27)), r, s };
  await send(
    "purchaseWithPermit",
    await relayer.writeContract({
      address: chain.escrowAddress,
      abi: PREPAID_ESCROW_ABI,
      functionName: "purchaseWithPermit",
      args: [offer, fitbox.merchantSig, auth, consumerSig, permit],
    }),
  );
  const planId = (await client.readContract({ address: chain.escrowAddress, abi: PREPAID_ESCROW_ABI, functionName: "nextPlanId" })) - BigInt(1);

  // 4. Twelve check-ins: the gym tablet signs, Lin signs the same Redeem, the relayer submits.
  const readPlan = async (id: bigint) => {
    const p = await readChainPlan(client, chain.escrowAddress, id);
    return p && { merchant: p.merchant, status: p.status, units: p.units, redeemed: p.redeemed };
  };
  for (let i = 1; i <= SESSIONS_USED; i++) {
    const c = await signCheckin({ planId, readPlan });
    const consumerRedeemSig = await consumer.signTypedData({
      domain,
      types: REDEEM_TYPES,
      primaryType: "Redeem",
      message: { planId, sessionNo: c.sessionNo, deadline: BigInt(c.deadline) },
    });
    await send(
      `redeem #${c.sessionNo}`,
      await relayer.writeContract({
        address: chain.escrowAddress,
        abi: PREPAID_ESCROW_ABI,
        functionName: "redeem",
        args: [planId, c.sessionNo, BigInt(c.deadline), consumerRedeemSig, c.merchantSig],
      }),
    );
  }

  // 5. Demo rows: Lin's wallet and FitBox's chain address are the real keys; the mock plan goes.
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  try {
    if (chain.chainId === LOCAL_ANVIL) {
      // A restarted anvil reuses addresses, plan ids and nonces: drop chain state indexed or
      // allocated against an earlier local chain (local only; never on Base Sepolia).
      await admin.query("delete from public.chain_cursors where contract like 'PrepaidEscrow:%'");
      await admin.query("delete from public.chain_nonces");
      await admin.query("delete from public.chain_txs");
      await admin.query("delete from public.prepaid_plans where purchase_tx like '0x%'");
    }
    await admin.query("update public.prepaid_merchants set chain_address = $1, updated_at = now() where id = 'FITBOX_FUTIAN'", [offer.merchant]);
    await admin.query("update public.wallets set address = $2 where user_id = $1 and kind = 'consumer_browser'", [LIN, consumer.address]);
    await admin.query("delete from public.prepaid_plans where user_id = $1 and purchase_tx like 'mock:%'", [LIN]);
  } finally {
    await admin.end();
  }

  // 6. Index Lin's plan.
  const stats = await runChainSync(getPool(), {
    client,
    escrow: chain.escrowAddress,
    userIds: [LIN],
    startBlock: BigInt(process.env.CHAIN_START_BLOCK ?? "0"),
    confirmations: 0,
  });
  await getPool().end();
  console.log(`chain-sync: ${JSON.stringify(stats)}`);
  console.log(`Lin's plan ${planId} is on chain with ${SESSIONS_USED} sessions used and ${offer.units - SESSIONS_USED} in escrow.`);
  console.log("Next: POST /sim/registry/publish {merchant: FITBOX_FUTIAN, kind: court_enforcement}, then run /api/cron/risk.");
}
