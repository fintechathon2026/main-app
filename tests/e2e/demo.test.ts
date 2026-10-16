// R1-15: the rest of the demo path (task.md §9 shots 5 and 8) replays from
// evals/recordings/demo_lin with no model at all: trial auto-cancel (T3), attested prepaid exit,
// and a fake complaint with injected text that only raises a warning. The bill shots are in
// bill.test.ts. Same stack and requirements as bill.test.ts; Lin's subscription and prepaid
// rows are restored after every test.

import { Pool } from "pg";
import type { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { RecordedModelClient } from "@/src/agent/models/recorded";
import type { GraphStateT } from "@/src/agent/graph";
import type { SignalWarning } from "@/src/agent/state";
import { verifyAuditChain } from "@/src/server/audit";
import { getPool, setPool } from "@/src/server/db/pool";
import { getMockbankPool, setMockbankPool } from "@/src/mockbank/db";
import { DB_ENABLED, adminPool } from "../foundations/helpers";
import { CapturingModelClient } from "../harness/capture";
import {
  FITBOX_CHAIN_PLAN,
  FITBOX_ESCROW_BALANCE,
  FITBOX_PLAN,
  KEEP_TRIAL,
  LIN,
  SOFT_SIGNALS,
  allRoles,
  attestedExitFlow,
  createLinEnv,
  postgresCheckpointer,
  repoJson,
  restorePrepaid,
  restoreTrial,
  softSignalFlow,
  trialFlow,
  type FlowResult,
  type LinEnv,
} from "./lin";

type AttackIndex = { cases: { file: string; canary: string; injectedWallet?: string }[] };
const signalCase = repoJson<AttackIndex>("evals/cases/attacks/index.json").cases.find((c) => SOFT_SIGNALS.endsWith(c.file))!;

const errors = (r: FlowResult) => r.events.filter((e) => e.type === "error");

describe.skipIf(!DB_ENABLED)("e2e: demo path replays from demo_lin recordings (R1-15)", () => {
  let admin: Pool;
  let saver: PostgresSaver;
  let models: CapturingModelClient;
  let env: LinEnv;

  const restore = async () => {
    await restoreTrial(admin);
    await restorePrepaid(admin);
  };

  beforeAll(async () => {
    admin = adminPool();
    saver = await postgresCheckpointer(admin);
    models = new CapturingModelClient(new RecordedModelClient({ scenario: "demo_lin" }));
    env = createLinEnv({ models: allRoles(models), saver });
    await restore();
  });

  afterEach(async () => {
    models.reset();
    await restore();
  });

  afterAll(async () => {
    await restore();
    await saver.end();
    await admin.end();
    await getPool().end();
    setPool(null);
    await getMockbankPool().end();
    setMockbankPool(null);
  });

  const planActions = async (planId: string) =>
    (await admin.query("select tool, args_json, status, decision, rule_ids, result_json from public.actions where plan_id = $1 order by idx", [planId]))
      .rows;

  it("trial auto-cancel (T3): allowed by §subscriptions.auto_cancel_trials without an approval, cancelled at the bank", async () => {
    const r = await trialFlow(env, admin);
    expect(errors(r)).toEqual([]);
    expect(r.approvalId).toBeNull();
    const actions = await planActions(r.planId);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ tool: "cancel_subscription", args_json: { subscription_id: KEEP_TRIAL }, status: "succeeded", decision: "allow" });
    expect(actions[0].rule_ids).toContain("subscriptions.auto_cancel_trials");
    const bank = await admin.query("select status from mockbank.subscriptions where id = $1", [KEEP_TRIAL]);
    expect(bank.rows[0].status).toBe("cancelled");

    // This line has no settlement reference, so the recorded Explainer rephrasing replays.
    expect(models.chatsFor("explainer")).toHaveLength(1);
    expect(r.feed).toContain("Done: Cancel (§global.kill_switch, §mandate.valid, §schema.cancel_subscription, §subscriptions.auto_cancel_trials, mandate v3).");
  });

  it("attested exit: with an oracle attestation the Gate allows prepaid_exit and the escrow refunds Lin", async () => {
    const r = await attestedExitFlow(env, admin);
    expect(errors(r)).toEqual([]);
    expect(r.approvalId).toBeNull();
    const actions = await planActions(r.planId);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ tool: "prepaid_exit", args_json: { plan_id: FITBOX_PLAN }, status: "succeeded", decision: "allow" });
    expect(actions[0].rule_ids).toContain("prepaid.auto_exit_on");
    expect(actions[0].result_json).toMatchObject({ mode: "attested", simulated: true });
    const owner = (await admin.query("select owner from mockbank.escrow_plans where chain_plan_id = $1", [FITBOX_CHAIN_PLAN])).rows[0].owner;
    expect(actions[0].result_json.events[0]).toMatchObject({ refundTo: owner, refund: String(FITBOX_ESCROW_BALANCE), fee: "0" });

    const escrow = await admin.query("select status, balance::bigint::text as balance from mockbank.escrow_plans where chain_plan_id = $1", [
      FITBOX_CHAIN_PLAN,
    ]);
    expect(escrow.rows[0]).toEqual({ status: "exited_attested", balance: "0" });
    expect(r.feed.some((l) => /^Exit prepaid plan FitBox Futian: allowed by .*§prepaid\.auto_exit_on v3\. tx mock:/.test(l))).toBe(true);
    expect((await verifyAuditChain(LIN)).ok).toBe(true);
  });

  it("soft signal with injected text: a warning labeled origin=web, no exit proposed, escrow untouched", async () => {
    const r = await softSignalFlow(env);
    expect(errors(r)).toEqual([]);
    expect(await planActions(r.planId)).toEqual([]);

    const state = (await env.graph.getState({ configurable: { thread_id: r.planId } })).values as GraphStateT;
    expect(state.warnings).toHaveLength(1);
    expect(state.warnings[0].origin).toBe("web");
    expect((state.warnings[0].value as SignalWarning).level).toBe("watch");

    // The wallet was tokenized before the Signal Reader call; neither it nor the canary reached
    // the Planner.
    const sig = models.structureds.filter((s) => s.role === "signal_reader");
    expect(sig).toHaveLength(1);
    expect(sig[0].input).not.toContain(signalCase.injectedWallet!);
    for (const req of models.chatsFor("planner")) {
      const seen = req.system + JSON.stringify(req.messages);
      expect(seen).not.toContain(signalCase.canary);
      expect(seen.toLowerCase()).not.toContain(signalCase.injectedWallet!.toLowerCase());
    }

    expect(r.feed.some((l) => /warning only/i.test(l))).toBe(true);
    const escrow = await admin.query("select status, balance::bigint::text as balance from mockbank.escrow_plans where chain_plan_id = $1", [
      FITBOX_CHAIN_PLAN,
    ]);
    expect(escrow.rows[0]).toEqual({ status: "active", balance: String(FITBOX_ESCROW_BALANCE) });
  });
});
