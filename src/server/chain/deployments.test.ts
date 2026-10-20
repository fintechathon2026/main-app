// Owner: R3 (roles.md). Known deployments match contracts/deployments, and chain-sync starts at
// the deploy block unless CHAIN_START_BLOCK says otherwise.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chainSyncOptionsFromEnv } from "./client";
import { KNOWN_DEPLOYMENTS } from "./deployments";

const json = JSON.parse(readFileSync(new URL("../../../contracts/deployments/84532.json", import.meta.url), "utf8")) as {
  chainId: number;
  deployBlock: number;
  escrow: string;
};
const baseSepolia = { chainId: 84532, escrowAddress: json.escrow as `0x${string}` };

describe("known deployments", () => {
  it("match contracts/deployments/84532.json", () => {
    const known = KNOWN_DEPLOYMENTS[json.chainId];
    expect(known.escrow.toLowerCase()).toBe(json.escrow.toLowerCase());
    expect(known.deployBlock).toBe(BigInt(json.deployBlock));
  });
});

describe("chainSyncOptionsFromEnv", () => {
  it("starts at the deploy block of the known escrow when CHAIN_START_BLOCK is unset", () => {
    expect(chainSyncOptionsFromEnv(baseSepolia, {}).startBlock).toBe(BigInt(48356082));
    expect(chainSyncOptionsFromEnv(baseSepolia, { CHAIN_START_BLOCK: "" }).startBlock).toBe(BigInt(48356082));
    expect(chainSyncOptionsFromEnv({ ...baseSepolia, escrowAddress: json.escrow.toLowerCase() as `0x${string}` }, {}).startBlock).toBe(
      BigInt(48356082),
    );
  });

  it("prefers an explicit CHAIN_START_BLOCK", () => {
    expect(chainSyncOptionsFromEnv(baseSepolia, { CHAIN_START_BLOCK: "123" }).startBlock).toBe(BigInt(123));
    expect(() => chainSyncOptionsFromEnv(baseSepolia, { CHAIN_START_BLOCK: "abc" })).toThrow("CHAIN_START_BLOCK must be a block number");
  });

  it("starts at 0 for other escrows and local chains", () => {
    expect(chainSyncOptionsFromEnv({ chainId: 84532, escrowAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3" }, {}).startBlock).toBe(
      BigInt(0),
    );
    expect(chainSyncOptionsFromEnv({ chainId: 31337, escrowAddress: baseSepolia.escrowAddress }, {}).startBlock).toBe(BigInt(0));
  });

  it("parses the optional numbers", () => {
    expect(chainSyncOptionsFromEnv(baseSepolia, {})).toEqual({
      startBlock: BigInt(48356082),
      chunk: undefined,
      confirmations: undefined,
      logDelayMs: undefined,
    });
    const o = chainSyncOptionsFromEnv(baseSepolia, { CHAIN_LOG_CHUNK: "10", CHAIN_CONFIRMATIONS: "0", CHAIN_LOG_DELAY_MS: "200" });
    expect(o).toMatchObject({ chunk: 10, confirmations: 0, logDelayMs: 200 });
    expect(chainSyncOptionsFromEnv(baseSepolia, { CHAIN_LOG_CHUNK: "" }).chunk).toBeUndefined();
    expect(() => chainSyncOptionsFromEnv(baseSepolia, { CHAIN_LOG_CHUNK: "abc" })).toThrow("CHAIN_LOG_CHUNK");
    expect(() => chainSyncOptionsFromEnv(baseSepolia, { CHAIN_LOG_CHUNK: "0" })).toThrow("CHAIN_LOG_CHUNK");
    expect(() => chainSyncOptionsFromEnv(baseSepolia, { CHAIN_LOG_DELAY_MS: "-1" })).toThrow("CHAIN_LOG_DELAY_MS");
  });
});
