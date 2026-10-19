// Owner: R3 (roles.md).
// The merchant simulator's own catalogue (architecture §24.7). Ids match the seeded
// prepaid_merchants (supabase/seed.sql), but this is the outside party's copy, not a read of
// Reins' database. Amounts are in fen.
export type SimMerchantTerms = {
  id: string;
  name: string;
  escrowSupported: boolean;
  unitPrice: number;
  units: number;
  cancelFeeBps: number;
};

export const MERCHANT_CATALOGUE: readonly SimMerchantTerms[] = [
  { id: "FITBOX_FUTIAN", name: "FitBox Futian", escrowSupported: true, unitPrice: 10000, units: 60, cancelFeeBps: 1000 },
  // Listed without escrow so the mandate's `escrow_only` rule can be exercised.
  { id: "IRONPULSE_NANSHAN", name: "IronPulse Nanshan", escrowSupported: false, unitPrice: 8000, units: 50, cancelFeeBps: 1500 },
];
