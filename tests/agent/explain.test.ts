import { describe, expect, it } from "vitest";
import type { AuditRow } from "@/src/agent/deps";
import { UNVERIFIED_ANSWER, rephrase, templateLine } from "@/src/agent/nodes/explain";
import { extractNumbers } from "@/src/agent/nodes/numbers";
import type { ChatResponse } from "@/src/agent/models/types";
import { ScriptedModelClient, harnessWith, initialInput } from "./fakes";

const row: AuditRow = {
  actionId: "a1",
  tool: "pay_bill",
  decision: "require_confirm",
  ruleIds: ["bills.anomaly"],
  mandateVersion: 7,
  payeeName: "PLN",
  amount: 1250000,
  currency: "IDR",
  txHash: "0x9f8e7d6c5b4a39281706",
};
const say = (text: string): ChatResponse => ({ text, toolCalls: [], stopReason: "end_turn" });

describe("Explainer templates", () => {
  it("fills the documented template with currency and short tx hash", () => {
    expect(templateLine(row)).toBe("Pay PLN IDR 1,250,000: needs your approval by §bills.anomaly v7. tx 0x9f8e7d6c…");
    expect(templateLine({ ...row, txHash: undefined, decision: "deny", ruleIds: ["payees.new_payee", "provenance"] })).toBe(
      "Pay PLN IDR 1,250,000: blocked by §payees.new_payee, §provenance v7.",
    );
  });

  it("normalizes numbers for comparison", () => {
    expect(extractNumbers("IDR 1,250,000 and 3.50 on v7")).toEqual(["1250000", "3.5", "7"]);
  });
});

describe("Explainer post-check", () => {
  const line = templateLine(row);

  it("keeps a rephrase that copies every number and the tx hash", async () => {
    const ok = "Paying PLN IDR 1,250,000 needs your approval (§bills.anomaly, v7). tx 0x9f8e7d6c…";
    await expect(rephrase(new ScriptedModelClient({ explainer: [say(ok)] }), [line])).resolves.toEqual([ok]);
  });

  it("falls back to the raw template when a number differs", async () => {
    const bad = "Paying PLN IDR 1,200,000 needs your approval (§bills.anomaly, v7). tx 0x9f8e7d6c…";
    await expect(rephrase(new ScriptedModelClient({ explainer: [say(bad)] }), [line])).resolves.toEqual([line]);
  });

  it("falls back when a number is added, the hash is dropped, the line count changes, or the call fails", async () => {
    const extra = "Paying PLN IDR 1,250,000 (about 80 USD) needs your approval (§bills.anomaly, v7). tx 0x9f8e7d6c…";
    const noTx = "Paying PLN IDR 1,250,000 needs your approval (§bills.anomaly, v7). tx 0x9f8e7d6c";
    for (const r of [say(extra), say(noTx), say(`${line}\n${line}`), new Error("boom")]) {
      await expect(rephrase(new ScriptedModelClient({ explainer: [r] }), [line])).resolves.toEqual([line]);
    }
  });

  it("graph: a mismatched rephrase is replaced by the template in the feed", async () => {
    const h = harnessWith(
      new ScriptedModelClient({
        planner: [
          { text: "", toolCalls: [{ id: "t1", name: "pay_bill", args: { bill_id: "bill_1", biller_id: "SZ_POWER", amount: 120 } }], stopReason: "tool_use" },
          say("Queued."),
        ],
        explainer: [say("Paid SZ Power CNY 1,200: allowed by §bills.auto_pay_max v3. tx 0xabcdef12…")],
      }),
    );
    await h.graph.invoke(initialInput("pay it"), h.config);
    const { feed } = (await h.graph.getState(h.config)).values;
    expect(feed.at(-1)).toBe("Pay SZ Power CNY 120: allowed by §bills.auto_pay_max v3. tx 0xabcdef12…");
  });

  it("graph: a Planner reply with a number no tool returned is withheld", async () => {
    const h = harnessWith(new ScriptedModelClient({ planner: [say("You spent 4,321 last month.")] }));
    await h.graph.invoke(initialInput("how much did I spend?"), h.config);
    expect((await h.graph.getState(h.config)).values.feed).toEqual([UNVERIFIED_ANSWER]);
  });
});
