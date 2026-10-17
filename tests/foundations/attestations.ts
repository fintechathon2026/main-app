// Signed attestation rows for DB tests, as the risk job would store them (raw_json is the wire
// object, signature recovers to the oracle). The executor re-verifies the EIP-712 signature at
// decision time, so tests must sign for real. Test-only key; never used outside tests.

import type { Pool } from "pg";
import { keccak256, toHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  ATTESTATION_KIND_CODE,
  ATTESTATION_PRIMARY_TYPE,
  ATTESTATION_TYPES,
  attestationDomainFromEnv,
  toAttestationMessage,
  type AttestationKind,
} from "@/src/sim/registry/eip712";

// anvil test key #1; test-only
export const TEST_ORACLE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
export const TEST_ORACLE_ADDRESS = privateKeyToAccount(TEST_ORACLE_KEY).address;

/** Points the executor's ORACLE_ADDRESS at the test oracle; returns a restore function. */
export function setTestOracle(): () => void {
  const saved = process.env.ORACLE_ADDRESS;
  process.env.ORACLE_ADDRESS = TEST_ORACLE_ADDRESS;
  return () => {
    if (saved === undefined) delete process.env.ORACLE_ADDRESS;
    else process.env.ORACLE_ADDRESS = saved;
  };
}

export const caseRefFor = (label: string): Hex => keccak256(toHex(label));

export type SignedAttestationInput = {
  merchantId: string;
  kind?: AttestationKind;
  caseLabel: string;
  issuedAgoSeconds?: number;
  validForSeconds?: number;
  /** Sign with another key (a forgery). */
  signerKey?: Hex;
  /** Store sig_valid = true and signer = oracle even for a forgery (a tampered cache). */
  claimValid?: boolean;
  /** Merchant address inside the signed message (defaults to the merchant's own). */
  merchantAddress?: string;
};

/** Signs and inserts (or replaces) one attestation row; returns its id. */
export async function insertSignedAttestation(admin: Pool, input: SignedAttestationInput): Promise<string> {
  const m = await admin.query("select chain_address from public.prepaid_merchants where id = $1", [input.merchantId]);
  const merchant = input.merchantAddress ?? (m.rows[0].chain_address as string);
  const kind = input.kind ?? "court_enforcement";
  const nowS = Math.floor(Date.now() / 1000);
  const issuedAt = nowS - (input.issuedAgoSeconds ?? 3600);
  const expiresAt = issuedAt + (input.validForSeconds ?? 30 * 86_400);
  const caseRef = caseRefFor(input.caseLabel);
  const wire = { merchant, kind: ATTESTATION_KIND_CODE[kind], caseRef, issuedAt, expiresAt };
  const account = privateKeyToAccount(input.signerKey ?? TEST_ORACLE_KEY);
  const signature = await account.signTypedData({
    domain: attestationDomainFromEnv(),
    types: ATTESTATION_TYPES,
    primaryType: ATTESTATION_PRIMARY_TYPE,
    message: toAttestationMessage(wire),
  });
  const r = await admin.query(
    `insert into public.attestations (merchant_id, kind, case_ref_hash, issued_at, expires_at, signer, signature, sig_valid, raw_json)
     values ($1, $2, $3, to_timestamp($4), to_timestamp($5), $6, $7, $8, $9)
     on conflict (merchant_id, kind, case_ref_hash) do update
       set issued_at = excluded.issued_at, expires_at = excluded.expires_at, signer = excluded.signer,
           signature = excluded.signature, sig_valid = excluded.sig_valid, raw_json = excluded.raw_json
     returning id`,
    [
      input.merchantId,
      kind,
      caseRef.toLowerCase(),
      issuedAt,
      expiresAt,
      input.claimValid && input.signerKey ? TEST_ORACLE_ADDRESS : account.address,
      signature,
      input.claimValid ?? !input.signerKey,
      JSON.stringify({ ...wire, signature, simulated: true }),
    ],
  );
  return r.rows[0].id as string;
}

export const randomKey = () => generatePrivateKey();
