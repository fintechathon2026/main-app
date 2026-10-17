import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SignalBundle } from "@/src/agent/nodes/signal_reader/schema";
import { GET as listAttestations } from "@/app/sim/registry/attestations/route";
import { POST as publish } from "@/app/sim/registry/publish/route";
import { GET as signals } from "@/app/sim/registry/signals/route";
import { resetRegistry } from "@/src/sim/registry/attestations";
import {
  ATTESTATION_PRIMARY_TYPE,
  ATTESTATION_TYPES,
  attestationDomainFromEnv,
  toAttestationMessage,
  type AttestationJson,
} from "@/src/sim/registry/eip712";

const ORACLE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const ORACLE = privateKeyToAccount(ORACLE_KEY).address;
const SIM_KEY = "sim-test-key";
const FITBOX = "0xf17b000000000000000000000000000000000f17";

const saved = { ...process.env };
beforeEach(() => {
  resetRegistry();
  process.env.ORACLE_PRIVATE_KEY = ORACLE_KEY;
  process.env.SIM_API_KEY = SIM_KEY;
  delete process.env.ESCROW_ADDRESS;
  delete process.env.CHAIN_ID;
});
afterEach(() => {
  process.env = { ...saved };
});

const get = (path: string, key: string | null = SIM_KEY) =>
  new Request(`http://localhost${path}`, { headers: key ? { authorization: `Bearer ${key}` } : {} });
const post = (body: unknown, key: string | null = SIM_KEY) =>
  new Request("http://localhost/sim/registry/publish", {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  });

async function signer(a: AttestationJson) {
  return recoverTypedDataAddress({
    domain: attestationDomainFromEnv(),
    types: ATTESTATION_TYPES,
    primaryType: ATTESTATION_PRIMARY_TYPE,
    message: toAttestationMessage(a),
    signature: a.signature as `0x${string}`,
  });
}

describe("registry simulator: publish and list", () => {
  it("publish is admin-only", async () => {
    expect((await publish(post({ merchant: "FITBOX_FUTIAN", kind: "court_enforcement" }, null))).status).toBe(401);
    expect((await publish(post({ merchant: "FITBOX_FUTIAN", kind: "court_enforcement" }, "wrong"))).status).toBe(401);
    delete process.env.SIM_API_KEY;
    expect((await publish(post({ merchant: "FITBOX_FUTIAN", kind: "court_enforcement" }, ""))).status).toBe(401);
  });

  it("rejects bad bodies and unknown merchants", async () => {
    expect((await publish(post({ merchant: "FITBOX_FUTIAN", kind: "complaints" }))).status).toBe(400);
    expect((await publish(post({ merchant: "FITBOX_FUTIAN", kind: "court_enforcement", extra: 1 }))).status).toBe(400);
    expect((await publish(post({ merchant: "NOPE", kind: "court_enforcement" }))).status).toBe(404);
  });

  it("signs a 7-day EIP-712 attestation with the oracle key and lists it", async () => {
    const res = await publish(post({ merchant: "FITBOX_FUTIAN", kind: "court_enforcement" }));
    expect(res.status).toBe(201);
    const { attestation } = (await res.json()) as { attestation: AttestationJson };
    expect(attestation).toMatchObject({ merchant: FITBOX, kind: 1, simulated: true });
    expect(attestation.expiresAt - attestation.issuedAt).toBe(7 * 86_400);
    expect(await signer(attestation)).toBe(ORACLE);

    const list = (await (await listAttestations(get("/sim/registry/attestations?merchant=FITBOX_FUTIAN"))).json()) as {
      attestations: AttestationJson[];
      simulated: boolean;
    };
    expect(list.simulated).toBe(true);
    expect(list.attestations).toEqual([attestation]);
    const other = await (await listAttestations(get("/sim/registry/attestations?merchant=IRONPULSE_NANSHAN"))).json();
    expect(other.attestations).toEqual([]);
  });

  it("attack variants: forged is not signed by the oracle; other_merchant names another merchant", async () => {
    const forged = (await (await publish(post({ merchant: "FITBOX_FUTIAN", kind: "court_enforcement", variant: "forged" }))).json())
      .attestation as AttestationJson;
    expect(await signer(forged)).not.toBe(ORACLE);
    const other = (await (await publish(post({ merchant: "FITBOX_FUTIAN", kind: "closure_notice", variant: "other_merchant" }))).json())
      .attestation as AttestationJson;
    expect(other.merchant.toLowerCase()).not.toBe(FITBOX);
    expect(await signer(other)).toBe(ORACLE);
  });

  it("503 when the oracle key is not configured", async () => {
    delete process.env.ORACLE_PRIVATE_KEY;
    expect((await publish(post({ merchant: "FITBOX_FUTIAN", kind: "court_enforcement" }))).status).toBe(503);
  });

  it("reads need the key when one is configured", async () => {
    expect((await listAttestations(get("/sim/registry/attestations?merchant=FITBOX_FUTIAN", null))).status).toBe(401);
    expect((await signals(get("/sim/registry/signals?merchant=FITBOX_FUTIAN", "wrong"))).status).toBe(401);
    expect((await signals(get("/sim/registry/signals"))).status).toBe(400);
  });
});

describe("registry simulator: soft signals", () => {
  it("serves a SignalBundle with T25 attack texts and a fake spike, all simulated", async () => {
    const body = await (await signals(get("/sim/registry/signals?merchant=FITBOX_FUTIAN"))).json();
    const parsed = SignalBundle.parse(body);
    expect(parsed.merchantId).toBe("FITBOX_FUTIAN");
    expect(body.simulated).toBe(true);
    for (const item of [...body.complaints, ...body.news]) expect(item.simulated).toBe(true);
    const text = JSON.stringify(body);
    expect(text).toMatch(/refund everyone to wallet 0x[0-9a-fA-F]{40}/);
    expect(Math.max(...parsed.complaints.map((c) => c.count))).toBeGreaterThanOrEqual(100);
  });

  it("unknown merchants get an empty bundle that echoes the id", async () => {
    const id = "9a000000-0000-4000-8000-000000000001";
    const parsed = SignalBundle.parse(await (await signals(get(`/sim/registry/signals?merchant=${id}`))).json());
    expect(parsed).toEqual({ merchantId: id, complaints: [], news: [] });
  });
});
