// Shared fixtures for the chain suites (PRD_PrepaidEscrow_Contract §8.4, §8.5): a private anvil
// per test file, contracts deployed from the Foundry artifacts, and signing through the same
// TypeScript EIP-712 definitions the app uses. Suites skip when anvil or the artifacts are
// missing (run `cd contracts && forge build`; anvil comes with Foundry).
// Keys are anvil's well-known public test accounts; never use them on a real network.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseSignature,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";
import { actionHash } from "@/src/core/mandate/canonical";
import { PREPAID_ESCROW_ABI, TEST_CNY_ABI } from "@/src/server/chain/abi";
import {
  OFFER_TYPES,
  PURCHASE_AUTH_TYPES,
  REDEEM_TYPES,
  VOLUNTARY_EXIT_TYPES,
  escrowDomain,
  offerHash,
  toOfferMessage,
  toPurchaseAuthMessage,
  toVoluntaryExitMessage,
  type OfferJson,
  type PurchaseAuthJson,
} from "@/src/server/chain/types";
import { PERMIT_TYPES, tokenDomain, type PermitJson } from "@/src/server/chain/token";

const ROOT = new URL("../../", import.meta.url).pathname;
const artifact = (name: string) => `${ROOT}contracts/out/${name}.sol/${name}.json`;

function findAnvil(): string | null {
  for (const bin of ["anvil", `${homedir()}/.foundry/bin/anvil`]) {
    if (spawnSync(bin, ["--version"], { stdio: "ignore" }).status === 0) return bin;
  }
  return null;
}

export const ANVIL_BIN = findAnvil();
export const ARTIFACTS_READY = existsSync(artifact("PrepaidEscrow")) && existsSync(artifact("TestCNY"));
export const CHAIN_ENABLED = !!ANVIL_BIN && ARTIFACTS_READY;

export const KEYS = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  oracle: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // = TEST_ORACLE_KEY
  relayer: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  agent: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  merchant: "0x47e179ec197488593b187f80a00eb0da91f1c9b0b28dd4a3c7f0cdf4e4b8c3fc",
  consumer: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
} as const satisfies Record<string, Hex>;
export const ADDR = Object.fromEntries(Object.entries(KEYS).map(([k, v]) => [k, privateKeyToAccount(v).address])) as Record<
  keyof typeof KEYS,
  Address
>;

export type Chain = {
  rpcUrl: string;
  client: PublicClient;
  token: Address;
  escrow: Address;
  stop: () => Promise<void>;
};

/** Starts a private anvil and deploys TestCNY (owner: deployer) and PrepaidEscrow(token, oracle). */
export async function startChain(): Promise<Chain> {
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const rpcUrl = `http://127.0.0.1:${port}`;
  const proc: ChildProcess = spawn(ANVIL_BIN!, ["--port", String(port), "--silent"], { stdio: "ignore" });
  const client = createPublicClient({ chain: anvil, transport: http(rpcUrl), pollingInterval: 100 }) as PublicClient;
  for (let i = 0; ; i++) {
    try {
      await client.getChainId();
      break;
    } catch (e) {
      if (i > 100) throw e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const wallet = createWalletClient({ chain: anvil, transport: http(rpcUrl), account: privateKeyToAccount(KEYS.deployer) });
  const bytecode = (name: string) => (JSON.parse(readFileSync(artifact(name), "utf8")) as { bytecode: { object: Hex } }).bytecode.object;
  const tokenTx = await wallet.deployContract({ abi: TEST_CNY_ABI, bytecode: bytecode("TestCNY"), args: [ADDR.deployer] });
  const token = (await client.waitForTransactionReceipt({ hash: tokenTx })).contractAddress!;
  const escrowTx = await wallet.deployContract({ abi: PREPAID_ESCROW_ABI, bytecode: bytecode("PrepaidEscrow"), args: [token, ADDR.oracle] });
  const escrow = (await client.waitForTransactionReceipt({ hash: escrowTx })).contractAddress!;
  return {
    rpcUrl,
    client,
    token,
    escrow,
    stop: async () => {
      proc.kill();
    },
  };
}

export async function mint(chain: Chain, to: Address, amount: bigint): Promise<void> {
  const wallet = createWalletClient({ chain: anvil, transport: http(chain.rpcUrl), account: privateKeyToAccount(KEYS.deployer) });
  const hash = await wallet.writeContract({ address: chain.token, abi: TEST_CNY_ABI, functionName: "mint", args: [to, amount] });
  await chain.client.waitForTransactionReceipt({ hash });
}

export async function balanceOf(chain: Chain, who: Address): Promise<bigint> {
  return chain.client.readContract({ address: chain.token, abi: TEST_CNY_ABI, functionName: "balanceOf", args: [who] });
}

const domainOf = (chain: Chain) => escrowDomain({ chainId: anvil.id, escrowAddress: chain.escrow });

/** Everything purchaseWithPermit needs, as the executor and browser send it (JSON wire forms). */
export type SignedPurchase = {
  offer: OfferJson;
  merchantSig: Hex;
  auth: PurchaseAuthJson;
  consumerSig: Hex;
  permit: PermitJson;
  total: bigint;
};

/** Signs a purchase with the merchant and consumer keys, through the app's EIP-712 definitions. */
export async function signedPurchase(
  chain: Chain,
  opts: { consumerKey?: Hex; merchantKey?: Hex; unitPrice?: number; units?: number; cancelFeeBps?: number; agent?: Address } = {},
): Promise<SignedPurchase> {
  const consumer = privateKeyToAccount(opts.consumerKey ?? KEYS.consumer);
  const merchant = privateKeyToAccount(opts.merchantKey ?? KEYS.merchant);
  const now = Math.floor(Date.now() / 1000);
  const offer: OfferJson = {
    merchant: merchant.address,
    unitPrice: opts.unitPrice ?? 10_000,
    units: opts.units ?? 60,
    cancelFeeBps: opts.cancelFeeBps ?? 1000,
    expiresAt: now + 86_400,
    nonce: String(Math.floor(Math.random() * 1e12)),
  };
  const domain = domainOf(chain);
  const merchantSig = await merchant.signTypedData({ domain, types: OFFER_TYPES, primaryType: "Offer", message: toOfferMessage(offer) });
  const auth: PurchaseAuthJson = { offerHash: offerHash(domain, offer), consumer: consumer.address, agent: opts.agent ?? ADDR.agent, deadline: now + 3600 };
  const consumerSig = await consumer.signTypedData({ domain, types: PURCHASE_AUTH_TYPES, primaryType: "PurchaseAuth", message: toPurchaseAuthMessage(auth) });
  const total = BigInt(offer.unitPrice) * BigInt(offer.units);
  const nonce = await chain.client.readContract({ address: chain.token, abi: TEST_CNY_ABI, functionName: "nonces", args: [consumer.address] });
  const deadline = BigInt(now + 3600);
  const permitSig = await consumer.signTypedData({
    domain: tokenDomain({ chainId: anvil.id, tokenAddress: chain.token }),
    types: PERMIT_TYPES,
    primaryType: "Permit",
    message: { owner: consumer.address, spender: chain.escrow, value: total, nonce, deadline },
  });
  const { r, s, v, yParity } = parseSignature(permitSig);
  return {
    offer,
    merchantSig,
    auth,
    consumerSig,
    permit: { value: total.toString(), deadline: deadline.toString(), v: Number(v ?? BigInt(yParity + 27)), r, s },
    total,
  };
}

/** The contract-call tuple for a signed purchase (for setup steps that bypass the adapter). */
export function purchaseCallArgs(p: SignedPurchase) {
  return [
    toOfferMessage(p.offer),
    p.merchantSig,
    toPurchaseAuthMessage(p.auth),
    p.consumerSig,
    { value: BigInt(p.permit.value), deadline: BigInt(p.permit.deadline), v: p.permit.v, r: p.permit.r, s: p.permit.s },
  ] as const;
}

/** Both signatures for check-in `sessionNo` of `planId`, in EscrowRedeemArgs form. */
export async function signedRedeem(chain: Chain, planId: bigint, sessionNo: number, keys: { consumer?: Hex; merchant?: Hex } = {}) {
  const deadline = Math.floor(Date.now() / 1000) + 600;
  const message = { planId, sessionNo, deadline: BigInt(deadline) };
  const domain = domainOf(chain);
  const consumerSig = await privateKeyToAccount(keys.consumer ?? KEYS.consumer).signTypedData({ domain, types: REDEEM_TYPES, primaryType: "Redeem", message });
  const merchantSig = await privateKeyToAccount(keys.merchant ?? KEYS.merchant).signTypedData({ domain, types: REDEEM_TYPES, primaryType: "Redeem", message });
  return { chainPlanId: planId.toString(), sessionNo, deadline, consumerSig, merchantSig };
}

/** The consumer's VoluntaryExit signature for `planId`. */
export async function signedVoluntaryExit(chain: Chain, planId: bigint, consumerKey: Hex = KEYS.consumer) {
  const deadline = Math.floor(Date.now() / 1000) + 600;
  const consumerSig = await privateKeyToAccount(consumerKey).signTypedData({
    domain: domainOf(chain),
    types: VOLUNTARY_EXIT_TYPES,
    primaryType: "VoluntaryExit",
    message: toVoluntaryExitMessage({ planId: planId.toString(), deadline }),
  });
  return { chainPlanId: planId.toString(), deadline, consumerSig };
}

/** Sends a transaction from a test key directly (setup steps that are not under test). */
export async function sendAs(chain: Chain, key: Hex, functionName: string, args: readonly unknown[]): Promise<Hex> {
  const wallet = createWalletClient({ chain: anvil, transport: http(chain.rpcUrl), account: privateKeyToAccount(key) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper over the whole ABI
  const hash = await wallet.writeContract({ address: chain.escrow, abi: PREPAID_ESCROW_ABI, functionName, args } as any);
  const receipt = await chain.client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted`);
  return hash;
}

/**
 * Each suite runs on a fresh anvil: same deterministic addresses, nonces from 0, plan ids from 1.
 * Drop what earlier runs left for this sender (nonce row, recorded transactions) so allocation
 * starts from the new chain's state. Each suite uses its own sender, so suites can run in parallel.
 */
export async function resetSenderState(admin: Pool, sender: "relayer" | "agent"): Promise<void> {
  await admin.query("delete from public.chain_txs where sender = $1", [sender]);
  await admin.query("delete from public.chain_nonces where sender = $1", [ADDR[sender].toLowerCase()]);
}

/** A plan row plus one action row for `userId`, so chain_txs can reference a real action. */
export async function userAction(admin: Pool, userId: string, tool: string, args: Record<string, unknown>): Promise<{ id: string; key: string }> {
  const plan = await admin.query("insert into public.plans (user_id, trigger, subject_id, status) values ($1, 'user_action', $2, 'running') returning id", [
    userId,
    randomUUID(),
  ]);
  const key = `test:${randomUUID()}`;
  const a = await admin.query(
    `insert into public.actions (plan_id, user_id, idx, tool, actor, args_json, args_hash, mandate_version, idempotency_key)
     values ($1, $2, 0, $3, 'user', $4, $5, 3, $6) returning id`,
    [plan.rows[0].id, userId, tool, JSON.stringify(args), actionHash(tool, args), key],
  );
  return { id: a.rows[0].id as string, key };
}
