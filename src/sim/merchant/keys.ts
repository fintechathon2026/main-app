// Owner: R3 (roles.md).
// The only reader of MERCHANT_SIM_PRIVATE_KEY (architecture §5.1). The key never leaves this
// module: callers get a viem local account.
import type { Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

export class MerchantKeyMissing extends Error {
  constructor() {
    super("MERCHANT_SIM_PRIVATE_KEY is not configured");
    this.name = "MerchantKeyMissing";
  }
}

/** The simulated merchant's signing account. Throws MerchantKeyMissing when unset or malformed. */
export function merchantAccount(env: Record<string, string | undefined> = process.env): PrivateKeyAccount {
  const k = env.MERCHANT_SIM_PRIVATE_KEY?.trim();
  if (!k || !/^0x[0-9a-fA-F]{64}$/.test(k)) throw new MerchantKeyMissing();
  return privateKeyToAccount(k as Hex);
}
