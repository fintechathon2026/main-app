// Owner: R2 (roles.md). GET /api/prepaid/signing: the public facts the browser needs to sign
// prepaid messages (EIP-712 domain, token for the permit, the agent a purchase must name, where the
// gym tablet is). Server config, so signer and verifier always build the same domain. No secrets.

import { connection } from "next/server";
import { chainConfigFromEnv } from "@/src/server/chain/client";
import { escrowDomainFromEnv } from "@/src/server/chain/types";

export type PrepaidSigningResponse = {
  mode: "mock" | "chain";
  domain: { name: string; version: string; chainId: number; verifyingContract: string };
  token: { address: string; name: string } | null;
  agent: string | null;
  /** Public RPC for reads (the token's permit nonce). Never a key-bearing URL in production. */
  rpcUrl: string | null;
  explorerTxBase: string | null;
};

const TOKEN_NAME = "Test CNY (no value)"; // TestCNY's EIP-2612 domain name (contracts/src/TestCNY.sol)

export async function GET(): Promise<Response> {
  await connection();
  const chain = process.env.REINS_ESCROW === "chain" ? chainConfigFromEnv() : null;
  const d = escrowDomainFromEnv();
  const body: PrepaidSigningResponse = {
    mode: chain ? "chain" : "mock",
    domain: { name: String(d.name), version: String(d.version), chainId: Number(d.chainId), verifyingContract: String(d.verifyingContract) },
    token: chain?.tokenAddress ? { address: chain.tokenAddress, name: TOKEN_NAME } : null,
    agent: process.env.AGENT_ADDRESS || null,
    // Only an explicitly public RPC: the server's BASE_SEPOLIA_RPC_URL may carry a provider key.
    rpcUrl: chain ? (process.env.NEXT_PUBLIC_RPC_URL || (chain.chainId === 84532 ? "https://sepolia.base.org" : null)) : null,
    explorerTxBase: chain && chain.chainId === 84532 ? "https://sepolia.basescan.org/tx/" : null,
  };
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
