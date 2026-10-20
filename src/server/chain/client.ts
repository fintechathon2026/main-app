// Owner: R3 (roles.md).
// Read-only chain access (PRD_PrepaidEscrow_Contract §7.9): a viem public client for
// CHAIN_ID over BASE_SEPOLIA_RPC_URL with BASE_SEPOLIA_RPC_URL_FALLBACK, and the deployed
// addresses. No keys here; signing clients live in src/server/adapters/settlement/chain/.

import { createPublicClient, defineChain, fallback, http, isAddress, type Address, type Chain, type PublicClient } from "viem";
import { anvil, baseSepolia } from "viem/chains";
import { PREPAID_ESCROW_ABI } from "./abi";

/** Contract Status enum (PrepaidEscrow.Status) -> the status strings used in the database. */
const PLAN_STATUS = ["none", "active", "completed", "exited_attested", "exited_voluntary"] as const;
export type ChainPlanStatus = Exclude<(typeof PLAN_STATUS)[number], "none">;

export function planStatusFromCode(code: number): ChainPlanStatus | null {
  const s = PLAN_STATUS[code];
  return s && s !== "none" ? s : null;
}

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
