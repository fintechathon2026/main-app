// In-memory state for REINS_FIXTURES=1 only (synthetic Lin data, no database). Lets the
// mandate editor and kill switch be exercised end to end in the UI before the DB is wired.
// Process-local and reset on restart; never used when fixtures are off.

import { hashPolicy } from "@/src/core/mandate/canonical";
import { LIN_MANDATE_V3 } from "@/src/core/mandate/examples";
import { diffPolicies, type ChangeClass, type DiffEntry } from "@/src/server/mandate/diff";
import { readback } from "@/src/server/mandate/readback";
import type { Policy } from "@/src/server/mandate/schema";
import type { ActivateResponse, MandateHistoryResponse, MandateVersion } from "@/src/server/mandate/store";

type Stored = Omit<MandateVersion, "readback">;

const seedPolicy = LIN_MANDATE_V3 as unknown as Policy;

const state: { versions: Stored[]; killSwitch: { enabled: boolean; changedAt: string } } = {
  versions: [
    {
      version: 3,
      policy: seedPolicy,
      policyHash: hashPolicy(seedPolicy),
      status: "active",
      createdVia: "template",
      signedAt: "2026-10-16T09:00:00.000Z",
    },
  ],
  killSwitch: { enabled: false, changedAt: "2026-10-16T00:00:00.000Z" },
};

const active = () => state.versions.find((v) => v.status === "active") ?? null;
const withoutVersion = (p: Policy): Policy => {
  const rest = { ...(p as Policy & { version?: number }) };
  delete rest.version;
  return rest;
};

export function fixtureActiveMandate(): { mandate: MandateVersion | null } {
  const a = active();
  return { mandate: a ? { ...a, readback: readback(a.policy) } : null };
}

export function fixtureHistory(): MandateHistoryResponse {
  let prev: Policy | null = null;
  const versions = state.versions.map((v) => {
    const d = prev ? diffPolicies(prev, v.policy) : { entries: [] as DiffEntry[], class: "none" as ChangeClass };
    prev = v.policy;
    return { version: v.version, policyHash: v.policyHash, status: v.status, createdVia: v.createdVia, signedAt: v.signedAt, diff: d.entries, class: d.class };
  });
  return { versions: versions.reverse() };
}

export function fixturePreview(candidate: Policy): { activeVersion: number | null; diff: DiffEntry[]; class: ChangeClass } {
  const a = active();
  const d = diffPolicies(a ? withoutVersion(a.policy) : null, candidate);
  return { activeVersion: a?.version ?? null, diff: d.entries, class: d.class };
}

export class FixtureActivateError extends Error {
  constructor(readonly code: "hash_mismatch" | "stale_base" | "widening_not_confirmed") {
    super(code);
  }
}

/** Same checks as activateMandate (store.ts), minus the database. */
export function fixtureActivate(input: { candidate: Policy; policyHash: string; baseVersion: number | null; createdVia: MandateVersion["createdVia"]; confirmWidening: boolean }): ActivateResponse {
  const a = active();
  if ((a?.version ?? null) !== input.baseVersion) throw new FixtureActivateError("stale_base");
  if (hashPolicy(input.candidate) !== input.policyHash) throw new FixtureActivateError("hash_mismatch");
  const d = diffPolicies(a ? withoutVersion(a.policy) : null, input.candidate);
  if (d.class === "widening" && !input.confirmWidening) throw new FixtureActivateError("widening_not_confirmed");

  if (a) a.status = "superseded";
  const version = (a?.version ?? 0) + 1;
  const policy = { ...input.candidate, version } as Policy;
  const row: Stored = { version, policy, policyHash: hashPolicy(policy), status: "active", createdVia: input.createdVia, signedAt: new Date().toISOString() };
  state.versions.push(row);
  return { mandate: { ...row, readback: readback(policy) }, diff: d.entries, class: d.class, expiredApprovals: 0 };
}

export function fixtureKillSwitch(): { enabled: boolean; changedAt: string } {
  return { ...state.killSwitch };
}

export function fixtureSetKillSwitch(enabled: boolean): { enabled: boolean; changedAt: string } {
  state.killSwitch = { enabled, changedAt: new Date().toISOString() };
  return { ...state.killSwitch };
}
