// Owner: R3 (roles.md). Minimal version by R1; extend, don't duplicate.
// The registry simulator's own merchant directory. It mirrors the seeded prepaid_merchants
// (supabase/seed.sql) but is the outside party's copy, not a read of Reins' database.

import { merchantAccount } from "../merchant/keys";

export type SimMerchant = { id: string; name: string; address: `0x${string}` };

export const SIM_MERCHANTS: readonly SimMerchant[] = [
  { id: "FITBOX_FUTIAN", name: "FitBox Futian", address: "0xf17b000000000000000000000000000000000f17" },
  { id: "IRONPULSE_NANSHAN", name: "IronPulse Nanshan", address: "0x1e0b000000000000000000000000000000001e0b" },
];

/** The merchant whose key the merchant simulator holds: its offers are signed by MERCHANT_SIM_PRIVATE_KEY. */
export const ESCROW_MERCHANT_ID = "FITBOX_FUTIAN";

/**
 * On chain the escrow merchant is the merchant simulator's key (src/sim/merchant/offers.ts signs
 * every offer with it), so a plan's merchant, an attestation about it and the seeded
 * prepaid_merchants.chain_address (scripts/chain-demo-setup.ts) must all name that address.
 * Without the key (mock escrow, tests) the fictional seeded address stays.
 */
export function simMerchantAddress(m: SimMerchant, env: Record<string, string | undefined> = process.env): `0x${string}` {
  if (m.id !== ESCROW_MERCHANT_ID) return m.address;
  try {
    return merchantAccount(env).address;
  } catch {
    return m.address;
  }
}

/** Resolve `?merchant=` given as a registry id or a 0x address. */
export function findSimMerchant(ref: string | null | undefined, env: Record<string, string | undefined> = process.env): SimMerchant | null {
  if (!ref) return null;
  const r = ref.trim().toLowerCase();
  return SIM_MERCHANTS.find((m) => m.id.toLowerCase() === r || m.address.toLowerCase() === r || simMerchantAddress(m, env).toLowerCase() === r) ?? null;
}
