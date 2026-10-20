// The committed ABI module must equal the compiled contracts (PRD_PrepaidEscrow_Contract §8.4).
// Skipped when contracts/out is missing (run `cd contracts && forge build`).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readArtifactAbi, renderAbiModule } from "@/scripts/export-contract-abi";
import { ARTIFACTS_READY } from "./anvil";

describe.skipIf(!ARTIFACTS_READY)("chain: generated ABI", () => {
  it("src/server/chain/abi.ts matches the Foundry artifacts", () => {
    const committed = readFileSync(new URL("../../src/server/chain/abi.ts", import.meta.url), "utf8");
    expect(committed).toBe(renderAbiModule(readArtifactAbi));
  });
});
