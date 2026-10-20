// Regression: a Signal Reader answer that fails its schema (e.g. a summary over 280 characters
// from a live model) failed the whole prepaid_risk plan, so an oracle-attested exit never
// reached the Planner or the Gate. Soft signals only warn; the plan must continue without them.
// Found while testing the attested exit on Base Sepolia, 2026-10-20.

import { describe, expect, it } from "vitest";
import type { ChatResponse } from "@/src/agent/models/types";
import { SignalReaderInvalidOutput } from "@/src/agent/nodes/signal_reader";
import { initialInput, recordThenReplay } from "./fakes";

const say = (text: string): ChatResponse => ({ text, toolCalls: [], stopReason: "end_turn" });

describe("agent graph: unreadable soft signals", () => {
  it("drops the warning and still reaches the planner", async () => {
    const h = await recordThenReplay(
      { planner: [say("No usable soft signal; checking the plan.")] },
      async (h) => {
        h.world.prepaidPlans.set("plan_fitbox", "merchant_fitbox");
        await h.graph.invoke(initialInput("", { trigger: "prepaid_risk", subjectId: "plan_fitbox" }), h.config);
      },
      {
        signalReader: () => ({
          read: async (merchantId: string) => {
            throw new SignalReaderInvalidOutput(merchantId, "schema", ["summary:too_big"]);
          },
        }),
      },
    );
    const req = h.models.requests.find((r) => r.role === "planner");
    expect(req).toBeDefined();
    const ctx = JSON.parse(req!.messages[0].role === "user" ? req!.messages[0].content : "{}");
    expect(ctx.warnings ?? []).toHaveLength(0);
  });

  it("still fails the plan on any other signal reader error", async () => {
    await expect(
      recordThenReplay(
        { planner: [say("unused")] },
        async (h) => {
          h.world.prepaidPlans.set("plan_fitbox", "merchant_fitbox");
          await h.graph.invoke(initialInput("", { trigger: "prepaid_risk", subjectId: "plan_fitbox" }), h.config);
        },
        {
          signalReader: () => ({
            read: async () => {
              throw new Error("registry unreachable");
            },
          }),
        },
      ),
    ).rejects.toThrow("registry unreachable");
  });
});
