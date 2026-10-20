// The "fully compromised Planner" (PRD §20.3): hand-written Planner answers from the case file,
// one per Planner turn, proposing exactly what the attack wants. Reader, Signal Reader and
// Explainer answers come from the demo script (tests/e2e/demo-script.ts). Only used to record
// evals/recordings/redteam through the real graph (scripts/record-redteam.ts); runs replay those
// recordings with RecordedModelClient. Never calls a model.

import type { ChatRequest, ChatResponse, ModelClient, StructuredRequest } from "@/src/agent/models/types";
import { DemoScriptModelClient } from "../../tests/e2e/demo-script";
import type { PlannerAnswer } from "./cases";
import { resolveIds } from "./persona";

export class RedteamScriptModelClient implements ModelClient {
  private readonly demo = new DemoScriptModelClient();
  private answers: PlannerAnswer[] = [];
  private label = "";

  /** Called by the runner before each turn's plan starts. */
  setTurn(label: string, answers: PlannerAnswer[]): void {
    this.label = label;
    this.answers = answers;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    if (req.role !== "planner") return this.demo.chat(req);
    const turn = req.messages.filter((m) => m.role === "assistant").length;
    const a = this.answers[turn] ?? { text: "Nothing more to do." };
    const usage = { inputTokens: 0, outputTokens: 0 };
    if (!("calls" in a)) return { text: a.text, toolCalls: [], stopReason: "end_turn", usage };
    return {
      text: a.text ?? "",
      toolCalls: a.calls.map((c, i) => ({ id: `toolu_rt_${this.label}_${turn}_${i}`, name: c.name, args: resolveIds(c.args) })),
      stopReason: "tool_use",
      usage,
    };
  }

  async structured<T>(req: StructuredRequest<T>): Promise<T> {
    return this.demo.structured(req);
  }
}
