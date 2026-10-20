// Owner: R3 (roles.md).
// Read-only chain access (PRD_PrepaidEscrow_Contract §7.9): a viem public client for
// CHAIN_ID over BASE_SEPOLIA_RPC_URL with BASE_SEPOLIA_RPC_URL_FALLBACK, and the deployed
// addresses. No keys here; signing clients live in src/server/adapters/settlement/chain/.

import { createPublicClient, defineChain, fallback, http, isAddress, type Address, type Chain, type PublicClient } from "viem";
import { anvil, baseSepolia } from "viem/chains";
import { PREPAID_ESCROW_ABI } from "./abi";
import { KNOWN_DEPLOYMENTS } from "./deployments";
import { planStatusFromCode, type ChainPlanStatus } from "./eip712";

export type ChainConfig = {
  chainId: number;
  rpcUrls: string[];
  escrowAddress: Address;
  tokenAddress: Address | null;
};

type Env = Record<string, string | undefined>;

/** Null when the chain is not configured (no valid ESCROW_ADDRESS or no RPC URL). */
export function chainConfigFromEnv(env: Env = process.env): ChainConfig | null {
  const escrow = env.ESCROW_ADDRESS?.trim();
  const rpcUrls = [env.BASE_SEPOLIA_RPC_URL, env.BASE_SEPOLIA_RPC_URL_FALLBACK].map((u) => u?.trim()).filter((u): u is string => !!u);
  if (!escrow || !isAddress(escrow) || rpcUrls.length === 0) return null;
  const token = env.TOKEN_ADDRESS?.trim();
  return {
    chainId: Number(env.CHAIN_ID ?? baseSepolia.id),
    rpcUrls,
    escrowAddress: escrow,
    tokenAddress: token && isAddress(token) ? token : null,
  };
}

export type ChainSyncEnvOptions = { startBlock: bigint; chunk?: number; confirmations?: number; logDelayMs?: number };

function envInt(env: Env, name: string, min: number): number | undefined {
  const v = env[name]?.trim();
  if (!v) return undefined;
  if (!/^\d+$/.test(v) || Number(v) < min || !Number.isSafeInteger(Number(v))) {
    throw new Error(`${name} must be an integer >= ${min}`);
  }
  return Number(v);
}

/**
 * chain-sync options from the env. Start block: CHAIN_START_BLOCK when set, else the deploy block
 * of a known deployment at the configured escrow, else 0 (local anvil). A saved cursor still wins
 * over it (runChainSync). CHAIN_LOG_CHUNK, CHAIN_CONFIRMATIONS and CHAIN_LOG_DELAY_MS are optional.
 */
export function chainSyncOptionsFromEnv(chain: Pick<ChainConfig, "chainId" | "escrowAddress">, env: Env = process.env): ChainSyncEnvOptions {
  const start = env.CHAIN_START_BLOCK?.trim();
  let startBlock: bigint;
  if (start) {
    if (!/^\d+$/.test(start)) throw new Error("CHAIN_START_BLOCK must be a block number");
    startBlock = BigInt(start);
  } else {
    const known = KNOWN_DEPLOYMENTS[chain.chainId];
    startBlock = known && known.escrow.toLowerCase() === chain.escrowAddress.toLowerCase() ? known.deployBlock : BigInt(0);
  }
  return {
    startBlock,
    chunk: envInt(env, "CHAIN_LOG_CHUNK", 1),
    confirmations: envInt(env, "CHAIN_CONFIRMATIONS", 0),
    logDelayMs: envInt(env, "CHAIN_LOG_DELAY_MS", 0),
  };
}

export function chainFor(chainId: number, rpcUrl: string): Chain {
  if (chainId === baseSepolia.id) return baseSepolia;
  if (chainId === anvil.id) return anvil;
  return defineChain({
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

export function publicClientFor(cfg: Pick<ChainConfig, "chainId" | "rpcUrls">): PublicClient {
  const transport = cfg.rpcUrls.length > 1 ? fallback(cfg.rpcUrls.map((u) => http(u))) : http(cfg.rpcUrls[0]);
  // Base Sepolia makes a block about every 2 s; viem's default 4 s poll would double receipt waits.
  return createPublicClient({ chain: chainFor(cfg.chainId, cfg.rpcUrls[0]), transport, pollingInterval: 1_000 }) as PublicClient;
}

/** On-chain plan as the escrow stores it. Amounts in fen. */
export type ChainPlan = {
  planId: bigint;
  consumer: Address;
  merchant: Address;
  agent: Address | null;
  unitPrice: bigint;
  units: number;
  redeemed: number;
  cancelFeeBps: number;
  status: ChainPlanStatus;
};

const ZERO = "0x0000000000000000000000000000000000000000";

/** Reads a plan; null when the id was never used (Status.None). */
export async function readChainPlan(client: PublicClient, escrow: Address, planId: bigint): Promise<ChainPlan | null> {
  const p = await client.readContract({ address: escrow, abi: PREPAID_ESCROW_ABI, functionName: "getPlan", args: [planId] });
  const status = planStatusFromCode(Number(p.status));
  if (!status) return null;
  return {
    planId,
    consumer: p.consumer,
    merchant: p.merchant,
    agent: p.agent === ZERO ? null : p.agent,
    unitPrice: p.unitPrice,
    units: Number(p.units),
    redeemed: Number(p.redeemed),
    cancelFeeBps: Number(p.cancelFeeBps),
    status,
  };
}
