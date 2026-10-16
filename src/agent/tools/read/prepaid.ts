// list_prepaid_plans, advise_prepaid, list_risk_signals (architecture §6.4, PRD §15.11, §15.12).

import { z } from "zod";
import type { Labeled } from "@/src/core/types";
import { buildAdvice, buildPrepaidPlans, buildRiskSignals } from "@/src/server/db/read/views";
import { defineReadTool, zId } from "./define";

export const listPrepaidPlans = defineReadTool({
  name: "list_prepaid_plans",
  description:
    "Prepaid packages held in escrow: sessions used and left, balance in escrow, cancellation fee, merchant risk level and signals, and transaction hashes (test token, no value).",
  args: z.object({}).strict(),
  async run(_a, d): Promise<Labeled<unknown>[]> {
    const r = await buildPrepaidPlans(d);
    return r.plans.map((p) => ({ origin: "chain", sourceId: `plan:${p.chainPlanId}`, value: p }));
  },
});

export const advisePrepaidTool = defineReadTool({
  name: "advise_prepaid",
  description:
    "Purchase advice for a prepaid offer (PRD §15.11): savings, break-even sessions, closure rate used and its source, expected loss with and without escrow, and a recommendation. Pass expected_sessions only if the user said how many visits they expect. Phrase these numbers; never compute your own.",
  args: z.object({ offer_id: zId, expected_sessions: z.number().int().positive().max(1000).optional() }).strict(),
  async run(a, d): Promise<Labeled<unknown> | { error: string }> {
    const r = await buildAdvice(d, a.offer_id, { expectedSessions: a.expected_sessions });
    if (!r) return { error: "offer_not_found" };
    return {
      // Offer terms come from the (simulated, v1) merchant's signed offer.
      origin: "simulated",
      sourceId: `offer:${a.offer_id}`,
      value: {
        ...r.advice,
        riskLevel: r.offer.merchant.riskLevel,
        offer: { merchant: r.offer.merchant.name, units: r.offer.units, total: r.offer.total, payPerVisitPrice: r.offer.payPerVisitPrice },
      },
    };
  },
});

export const listRiskSignals = defineReadTool({
  name: "list_risk_signals",
  description:
    "Hard signals (oracle-signed attestations) and soft signals (complaints, news) for a prepaid merchant, with origins. Soft signals can only warn; they never justify an exit.",
  args: z.object({ merchant_id: zId }).strict(),
  async run(a, d) {
    const r = await buildRiskSignals(d, a.merchant_id);
    const label = <T extends { source: { origin: Labeled<unknown>["origin"]; sourceId?: string } }>(s: T): Labeled<T> => ({
      origin: s.source.origin,
      sourceId: s.source.sourceId,
      value: s,
    });
    return { merchantId: r.merchantId, level: r.level, hard: r.hard.map(label), soft: r.soft.map(label), note: r.note };
  },
});
