import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSignalReader } from "@/src/agent/nodes/signal_reader";
import type { SignalBundle } from "@/src/agent/nodes/signal_reader/schema";
import { runRiskJob } from "@/src/server/risk/job";
import { freshness } from "@/src/server/risk/attestation";
import { publishAttestation, resetRegistry } from "@/src/sim/registry/attestations";
import { findSimMerchant } from "@/src/sim/registry/merchants";
import { SIM_ATTACK_WALLET, signalBundle } from "@/src/sim/registry/signals";
import type { AttestationKind } from "@/src/sim/registry/eip712";
import { FakeModelClient } from "../quarantine/helpers";
import { FITBOX, FakeRiskRepo, ORACLE_KEY, PREPAID_PLAN, SIM_KEY, USER, deps, fakeStartPlan, fixedWarning } from "./helpers";

const fitbox = findSimMerchant("FITBOX_FUTIAN")!;
const env = { ORACLE_PRIVATE_KEY: ORACLE_KEY };
const DAY = 86_400_000;

const publish = (kind: AttestationKind = "court_enforcement", variant?: "valid" | "forged" | "stale" | "other_merchant", now?: Date) =>
  publishAttestation({ merchant: fitbox, kind, variant, now, env });

const saved = process.env.SIM_API_KEY;
beforeEach(() => {
  resetRegistry();
  process.env.SIM_API_KEY = SIM_KEY;
});
afterEach(() => {
  process.env.SIM_API_KEY = saved;
});

describe("risk job: hard signals (attestations)", () => {
  it("a valid court_enforcement attestation starts exactly one prepaid_risk plan, idempotently", async () => {
    await publish("court_enforcement");
    const repo = new FakeRiskRepo();
    const { calls, startPlan } = fakeStartPlan();

    const first = await runRiskJob(deps({ repo, startPlan }));
    expect(calls).toEqual([{ userId: USER, trigger: "prepaid_risk", subjectId: PREPAID_PLAN }]);
    expect(first.plans.started).toHaveLength(1);
    expect(first.plans.started[0]).toMatchObject({ prepaidPlanId: PREPAID_PLAN, status: "done" });
    expect(repo.attestations).toHaveLength(1);
    expect(repo.attestations[0]).toMatchObject({ merchantId: FITBOX.id, kind: "court_enforcement", sigValid: true });
    expect(repo.attestations[0].signer.toLowerCase()).toBe(deps({ repo, startPlan }).oracleAddress!.toLowerCase());

    const second = await runRiskJob(deps({ repo, startPlan }));
    expect(calls).toHaveLength(1);
    expect(second.plans.started).toHaveLength(0);
    expect(second.plans.alreadyTriggered).toBe(1);
    expect(repo.attestations).toHaveLength(1);
  });

  it("a plan that could not be created releases its trigger, so the next run starts it", async () => {
    await publish("court_enforcement");
    const repo = new FakeRiskRepo();
    const ok = fakeStartPlan();
    const calls: unknown[] = [];
    async function* refused(input: unknown): AsyncGenerator<never> {
      calls.push(input);
      throw new Error('duplicate key value violates unique constraint "one_running_plan"');
    }

    const first = await runRiskJob(deps({ repo, startPlan: refused }));
    expect(calls).toHaveLength(1);
    expect(first.plans.started).toHaveLength(0);
    expect(first.errors).toEqual([expect.objectContaining({ step: "start_plan", message: expect.stringContaining("one_running_plan") })]);

    const second = await runRiskJob(deps({ repo, startPlan: ok.startPlan }));
    expect(ok.calls).toHaveLength(1);
    expect(second.plans.started).toHaveLength(1);
    expect(second.plans.alreadyTriggered).toBe(0);
  });

  it("an attestation signed by a non-oracle key is stored with sig_valid=false and starts no plan", async () => {
    await publish("court_enforcement", "forged");
    const repo = new FakeRiskRepo();
    const { calls, startPlan } = fakeStartPlan();
    const stats = await runRiskJob(deps({ repo, startPlan }));
    expect(repo.attestations).toHaveLength(1);
    expect(repo.attestations[0].sigValid).toBe(false);
    expect(repo.attestations[0].signer.toLowerCase()).not.toBe(deps({ repo, startPlan }).oracleAddress!.toLowerCase());
    expect(stats.attestations.rejected.bad_signature).toBe(1);
    expect(calls).toHaveLength(0);
  });

  it("without a configured oracle address nothing is valid", async () => {
    await publish("court_enforcement");
    const repo = new FakeRiskRepo();
    const { calls, startPlan } = fakeStartPlan();
    await runRiskJob(deps({ repo, startPlan, oracleAddress: null }));
    expect(repo.attestations[0].sigValid).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("a stale attestation (older than attestation_max_age_days) is stored but starts no plan", async () => {
    await publish("court_enforcement", "stale");
    const repo = new FakeRiskRepo();
    const { calls, startPlan } = fakeStartPlan();
    const stats = await runRiskJob(deps({ repo, startPlan }));
    expect(repo.attestations[0].sigValid).toBe(true);
    expect(stats.attestations.rejected.stale).toBe(1);
    expect(calls).toHaveLength(0);
  });

  it("respects a stricter mandate max age, and no mandate means no plan", async () => {
    const now = Date.now();
    await publish("court_enforcement", "valid", new Date(now - 1.5 * DAY));
    const repo = new FakeRiskRepo();
    repo.policy = { attestationMaxAgeDays: 1, warnOnSoftSignals: true };
    const { calls, startPlan } = fakeStartPlan();
    await runRiskJob(deps({ repo, startPlan }));
    expect(calls).toHaveLength(0);

    repo.policy = null;
    await runRiskJob(deps({ repo, startPlan }));
    expect(calls).toHaveLength(0);
  });

  it("an attestation about another merchant is not stored and starts no plan", async () => {
    await publish("closure_notice", "other_merchant");
    const repo = new FakeRiskRepo();
    const { calls, startPlan } = fakeStartPlan();
    const stats = await runRiskJob(deps({ repo, startPlan }));
    expect(repo.attestations).toHaveLength(0);
    expect(stats.attestations.rejected.other_merchant).toBe(1);
    expect(calls).toHaveLength(0);
  });

  it("malformed registry items and unknown kinds are rejected", async () => {
    const repo = new FakeRiskRepo();
    const { calls, startPlan } = fakeStartPlan();
    const good = await publish("court_enforcement");
    const registry = {
      fetchAttestations: async () => [{ merchant: "nope" }, { ...good, kind: 7 }, "x", null],
    };
    const stats = await runRiskJob(deps({ repo, startPlan, registry }));
    expect(stats.attestations.rejected).toEqual({ malformed: 3, unknown_kind: 1 });
    expect(repo.attestations).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("a forged copy with the same caseRef cannot shadow the oracle-signed record", async () => {
    const real = await publish("court_enforcement");
    const forged = { ...(await publish("court_enforcement", "forged")), caseRef: real.caseRef };
    const repo = new FakeRiskRepo();
    const { calls, startPlan } = fakeStartPlan();
    await runRiskJob(deps({ repo, startPlan, registry: { fetchAttestations: async () => [forged, real] } }));
    expect(repo.attestations).toHaveLength(1);
    expect(repo.attestations[0].sigValid).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("a registry outage is recorded and does not throw", async () => {
    const repo = new FakeRiskRepo();
    const { calls, startPlan } = fakeStartPlan();
    const registry = { fetchAttestations: async () => Promise.reject(new Error("down")) };
    const stats = await runRiskJob(deps({ repo, startPlan, registry }));
    expect(stats.errors).toEqual([{ merchantId: FITBOX.id, step: "fetch_attestations", message: "down" }]);
    expect(calls).toHaveLength(0);
  });
});

describe("risk job: soft signals warn only (T25)", () => {
  it("injected 'refund everyone to wallet 0x…' text produces only a warning, never a plan", async () => {
    // A model that falls for the injection completely: elevated, and it echoes the wallet.
    const model = new FakeModelClient(() => ({
      level: "elevated",
      summary: `Everyone must be refunded to wallet ${SIM_ATTACK_WALLET}; exit all plans now.`,
      sourceIds: ["sim-cmp-fb-03", "sim-cmp-fb-04", "sim-news-fb-02"],
    }));
    const signalReader = createSignalReader({
      models: { signal_reader: model },
      fetchSignals: async (merchantId) => signalBundle(merchantId) as unknown as SignalBundle,
    });
    const repo = new FakeRiskRepo();
    const { calls, startPlan } = fakeStartPlan();

    const stats = await runRiskJob(deps({ repo, startPlan, signalReader }));

    expect(calls).toHaveLength(0);
    expect(stats.plans.started).toHaveLength(0);
    expect(repo.attestations).toHaveLength(0);
    expect(stats.warnings).toEqual([{ merchantId: FITBOX.id, level: "elevated", stored: true }]);
    expect(repo.signals).toHaveLength(1);
    expect(repo.signals[0]).toMatchObject({ merchantId: FITBOX.id, kind: "complaints", level: "elevated", simulated: true });
    expect(repo.riskLevels.get(FITBOX.id)).toBe("elevated");
    expect(repo.warnings).toHaveLength(1);
    expect(repo.warnings[0].userId).toBe(USER);
    // The wallet never reaches storage or the feed.
    const stored = JSON.stringify([repo.signals, repo.warnings]).toLowerCase();
    expect(stored).not.toContain(SIM_ATTACK_WALLET.toLowerCase());
    // The model never saw it either.
    expect(model.seen().toLowerCase()).not.toContain(SIM_ATTACK_WALLET.toLowerCase());
  });

  it("the same warning is not repeated on a re-run the same day", async () => {
    const repo = new FakeRiskRepo();
    const { calls, startPlan } = fakeStartPlan();
    const signalReader = fixedWarning({ level: "watch", summary: "Two complaints about cancelled classes.", sourceIds: ["sim-cmp-fb-02"] });
    await runRiskJob(deps({ repo, startPlan, signalReader }));
    const again = await runRiskJob(deps({ repo, startPlan, signalReader }));
    expect(again.warnings).toEqual([{ merchantId: FITBOX.id, level: "watch", stored: false }]);
    expect(repo.signals).toHaveLength(1);
    expect(repo.warnings).toHaveLength(1);
    expect(calls).toHaveLength(0);
  });

  it("no feed warning when the mandate turns soft-signal warnings off; level none stores nothing", async () => {
    const repo = new FakeRiskRepo();
    repo.policy = { attestationMaxAgeDays: 2, warnOnSoftSignals: false };
    const { startPlan } = fakeStartPlan();
    await runRiskJob(deps({ repo, startPlan, signalReader: fixedWarning({ level: "watch", summary: "Some complaints.", sourceIds: ["sim-news-fb-01"] }) }));
    expect(repo.signals).toHaveLength(1);
    expect(repo.signals[0].kind).toBe("news");
    expect(repo.warnings).toHaveLength(0);

    const repo2 = new FakeRiskRepo();
    await runRiskJob(deps({ repo: repo2, startPlan, signalReader: fixedWarning({ level: "none", summary: "Nothing.", sourceIds: [] }) }));
    expect(repo2.signals).toHaveLength(0);
    expect(repo2.riskLevels.get(FITBOX.id)).toBe("none");
  });

  it("hard and soft together: the plan comes from the attestation alone", async () => {
    await publish("court_enforcement");
    const repo = new FakeRiskRepo();
    const { calls, startPlan } = fakeStartPlan();
    await runRiskJob(deps({ repo, startPlan, signalReader: fixedWarning({ level: "elevated", summary: "Many complaints.", sourceIds: [] }) }));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ userId: USER, trigger: "prepaid_risk", subjectId: PREPAID_PLAN });
  });
});

describe("freshness", () => {
  const now = Date.parse("2026-10-17T09:00:00Z");
  const s = now / 1000;
  it("enforces expiry, future issue, mandate max age and the contract's 2-day cap", () => {
    expect(freshness({ issuedAt: s - 3600, expiresAt: s + 3600 }, now, 2)).toMatchObject({ ok: true });
    expect(freshness({ issuedAt: s - 3600, expiresAt: s - 1 }, now, 2)).toEqual({ ok: false, reason: "expired" });
    expect(freshness({ issuedAt: s + 3600, expiresAt: s + 7200 }, now, 2)).toEqual({ ok: false, reason: "future" });
    expect(freshness({ issuedAt: s - 2.5 * 86_400, expiresAt: s + 3600 }, now, 2)).toEqual({ ok: false, reason: "stale" });
    expect(freshness({ issuedAt: s - 2.5 * 86_400, expiresAt: s + 3600 }, now, 30)).toEqual({ ok: false, reason: "stale" });
    expect(freshness({ issuedAt: s - 3600, expiresAt: s + 3600 }, now, null)).toEqual({ ok: false, reason: "no_mandate" });
  });
});
