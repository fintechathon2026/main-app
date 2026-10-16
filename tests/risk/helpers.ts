import { privateKeyToAccount } from "viem/accounts";
import type { Labeled } from "@/src/core/types";
import type { SignalReaderPort } from "@/src/agent/deps";
import type { SignalWarning } from "@/src/agent/state";
import type { StartPlanInput } from "@/src/agent/run";
import type { ChatStreamEvent } from "@/src/server/api-types";
import type {
  ActivePlan,
  AttestationRow,
  PrepaidPolicyFacts,
  RiskJobDeps,
  RiskLevel,
  RiskMerchant,
  RiskRepo,
  RiskSignalRow,
} from "@/src/server/risk/job";
import { createHttpRegistryClient } from "@/src/server/risk/registry-client";
import { handleListAttestations } from "@/src/sim/registry/http";
import { attestationDomain } from "@/src/sim/registry/eip712";

export const USER = "11111111-1111-4111-8111-111111111111";
export const PREPAID_PLAN = "9a000000-0000-4000-8000-000000000001";
export const FITBOX = { id: "FITBOX_FUTIAN", chainAddress: "0xf17b000000000000000000000000000000000f17" };
export const IRONPULSE = { id: "IRONPULSE_NANSHAN", chainAddress: "0x1e0b000000000000000000000000000000001e0b" };

// anvil test key #1; test-only
export const ORACLE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
export const ORACLE_ADDRESS = privateKeyToAccount(ORACLE_KEY).address;
export const SIM_KEY = "sim-test-key";

/** In-memory RiskRepo with the same semantics as the Postgres one. */
export class FakeRiskRepo implements RiskRepo {
  plans: ActivePlan[] = [{ userId: USER, planId: PREPAID_PLAN, merchantId: FITBOX.id }];
  merchants: RiskMerchant[] = [FITBOX, IRONPULSE];
  policy: PrepaidPolicyFacts | null = { attestationMaxAgeDays: 2, warnOnSoftSignals: true };
  attestations: (AttestationRow & { id: string })[] = [];
  triggers = new Set<string>();
  signals: RiskSignalRow[] = [];
  riskLevels = new Map<string, RiskLevel>();
  warnings: { userId: string; data: unknown }[] = [];

  async listActivePlans() {
    return this.plans;
  }
  async getMerchants(ids: string[]) {
    return this.merchants.filter((m) => ids.includes(m.id));
  }
  async saveAttestation(row: AttestationRow) {
    const i = this.attestations.findIndex((a) => a.merchantId === row.merchantId && a.kind === row.kind && a.caseRefHash === row.caseRefHash);
    if (i < 0) {
      const id = `att-${this.attestations.length + 1}`;
      this.attestations.push({ ...row, id });
      return { id, sigValid: row.sigValid };
    }
    const cur = this.attestations[i];
    if (!cur.sigValid && row.sigValid) this.attestations[i] = { ...row, id: cur.id };
    return { id: cur.id, sigValid: this.attestations[i].sigValid };
  }
  async prepaidPolicy() {
    return this.policy;
  }
  async claimExitTrigger(input: { prepaidPlanId: string; attestationId: string }) {
    const key = `${input.attestationId}:${input.prepaidPlanId}`;
    if (this.triggers.has(key)) return false;
    this.triggers.add(key);
    return true;
  }
  async saveSignal(row: RiskSignalRow) {
    const day = row.observedAt.toISOString().slice(0, 10);
    const dup = this.signals.some(
      (s) =>
        s.merchantId === row.merchantId &&
        s.kind === row.kind &&
        s.level === row.level &&
        s.sourceIds.join() === row.sourceIds.join() &&
        s.observedAt.toISOString().slice(0, 10) === day,
    );
    if (dup) return false;
    this.signals.push(row);
    return true;
  }
  async setMerchantRiskLevel(merchantId: string, level: RiskLevel) {
    this.riskLevels.set(merchantId, level);
  }
  async recordWarning(userId: string, data: unknown) {
    this.warnings.push({ userId, data });
  }
}

/** Records startPlan calls; each one yields a plan id and finishes. */
export function fakeStartPlan() {
  const calls: StartPlanInput[] = [];
  let n = 0;
  async function* startPlan(input: StartPlanInput): AsyncGenerator<ChatStreamEvent> {
    calls.push(input);
    const planId = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    yield { type: "plan", planId };
    yield { type: "done", planId, route: "execute" };
  }
  return { calls, startPlan };
}

export const noSignals: SignalReaderPort = { read: async () => null };

export function fixedWarning(value: SignalWarning): SignalReaderPort {
  return { read: async (merchantId) => ({ value, origin: "web", sourceId: merchantId }) as Labeled<SignalWarning> };
}

/** The registry client talking to the simulator's handler in-process. */
export const simRegistry = createHttpRegistryClient({
  baseUrl: "http://sim.test",
  apiKey: SIM_KEY,
  fetchImpl: async (input, init) => handleListAttestations(new Request(input as URL, init)),
});

export function deps(over: Partial<RiskJobDeps> & Pick<RiskJobDeps, "repo" | "startPlan">): RiskJobDeps {
  return {
    registry: simRegistry,
    signalReader: noSignals,
    domain: attestationDomain(),
    oracleAddress: ORACLE_ADDRESS,
    signalsSimulated: true,
    ...over,
  };
}
