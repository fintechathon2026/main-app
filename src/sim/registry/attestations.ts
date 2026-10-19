// Owner: R3 (roles.md). Minimal version by R1; extend, don't duplicate.
// Registry simulator: signed attestations (architecture §24.7, PRD §15.12). The registry is an
// outside party, so published attestations live in its own in-memory store, not in Reins'
// database. ORACLE_PRIVATE_KEY is read only here (src/sim/**).
//
// `variant` exists for the red-team and demo cases: the server must reject each of them.
//   valid           signed by the oracle, issuedAt = now, expiresAt = now + 7 days
//   forged          same message, signed by a fresh random key (not the oracle)
//   stale           signed by the oracle, issued 5 days ago
//   other_merchant  signed by the oracle, but about another merchant, listed under this one

import { keccak256, toHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  ATTESTATION_KIND_CODE,
  ATTESTATION_PRIMARY_TYPE,
  ATTESTATION_TYPES,
  attestationDomainFromEnv,
  toAttestationMessage,
  type AttestationJson,
  type AttestationKind,
} from "./eip712";
import { SIM_MERCHANTS, simMerchantAddress, type SimMerchant } from "./merchants";

export const ATTESTATION_VARIANTS = ["valid", "forged", "stale", "other_merchant"] as const;
export type AttestationVariant = (typeof ATTESTATION_VARIANTS)[number];

const DAY_S = 86_400;
const VALIDITY_DAYS = 7;
const STALE_DAYS = 5;

type Store = Map<string, AttestationJson[]>;
const STORE_KEY = Symbol.for("reins.sim.registry.attestations");

function store(): Store {
  const g = globalThis as unknown as Record<symbol, Store | undefined>;
  if (!g[STORE_KEY]) g[STORE_KEY] = new Map();
  return g[STORE_KEY]!;
}

/** For tests and the demo reset. */
export function resetRegistry(): void {
  store().clear();
}

export function listAttestations(merchant: SimMerchant): AttestationJson[] {
  return [...(store().get(merchant.id) ?? [])];
}

export class OracleKeyMissing extends Error {
  constructor() {
    super("ORACLE_PRIVATE_KEY is not configured");
    this.name = "OracleKeyMissing";
  }
}

function oracleKey(env: Record<string, string | undefined>): Hex {
  const k = env.ORACLE_PRIVATE_KEY?.trim();
  if (!k || !/^0x[0-9a-fA-F]{64}$/.test(k)) throw new OracleKeyMissing();
  return k as Hex;
}

/** Creates, signs and stores one attestation for `merchant`. */
export async function publishAttestation(input: {
  merchant: SimMerchant;
  kind: AttestationKind;
  variant?: AttestationVariant;
  now?: Date;
  env?: Record<string, string | undefined>;
}): Promise<AttestationJson> {
  const env = input.env ?? process.env;
  const variant = input.variant ?? "valid";
  const nowS = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const issuedAt = variant === "stale" ? nowS - STALE_DAYS * DAY_S : nowS;
  const subject =
    variant === "other_merchant" ? (SIM_MERCHANTS.find((m) => m.id !== input.merchant.id) ?? input.merchant) : input.merchant;

  // caseRef = hash of the registry record id (PRD §15.12); unique per publish.
  const caseRef = keccak256(toHex(`sim-registry:${subject.id}:${input.kind}:${crypto.randomUUID()}`));
  const fields = {
    merchant: simMerchantAddress(subject, env),
    kind: ATTESTATION_KIND_CODE[input.kind],
    caseRef,
    issuedAt,
    expiresAt: issuedAt + VALIDITY_DAYS * DAY_S,
  };

  const signerKey = variant === "forged" ? generatePrivateKey() : oracleKey(env);
  const signature = await privateKeyToAccount(signerKey).signTypedData({
    domain: attestationDomainFromEnv(env),
    types: ATTESTATION_TYPES,
    primaryType: ATTESTATION_PRIMARY_TYPE,
    message: toAttestationMessage(fields),
  });

  const att: AttestationJson = { ...fields, signature, simulated: true };
  const s = store();
  s.set(input.merchant.id, [...(s.get(input.merchant.id) ?? []), att]);
  return att;
}
