// Owner: R3 (roles.md). Minimal version by R1; extend, don't duplicate.
// The registry simulator's own merchant directory. It mirrors the seeded prepaid_merchants
// (supabase/seed.sql) but is the outside party's copy, not a read of Reins' database.

export type SimMerchant = { id: string; name: string; address: `0x${string}` };

export const SIM_MERCHANTS: readonly SimMerchant[] = [
  { id: "FITBOX_FUTIAN", name: "FitBox Futian", address: "0xf17b000000000000000000000000000000000f17" },
  { id: "IRONPULSE_NANSHAN", name: "IronPulse Nanshan", address: "0x1e0b000000000000000000000000000000001e0b" },
];

/** Resolve `?merchant=` given as a registry id or a 0x address. */
export function findSimMerchant(ref: string | null | undefined): SimMerchant | null {
  if (!ref) return null;
  const r = ref.trim();
  return SIM_MERCHANTS.find((m) => m.id === r || m.address.toLowerCase() === r.toLowerCase()) ?? null;
}
