// Regression: ISSUE-002 — an anomalous bill showed "Did not pass: bills.anomaly.over_threshold"
// in the Rule check, because the Gate's anomaly reason keys had no plain label.
// Found by /qa on 2026-10-20

import { describe, expect, it } from "vitest";
import { checksFromTrace } from "@/src/server/db/read/feed-view";

const gate = (reason: string) => ({
  decision: "require_confirm",
  trace: [
    { ruleId: "mandate.valid", result: "allow" },
    { ruleId: "bills.anomaly", result: "require_confirm", reason },
  ],
});

describe("anomaly steps in the Rule check", () => {
  it("names an unusual amount in plain words", () => {
    const step = checksFromTrace(gate("bills.anomaly.over_threshold"), 3).find((c) => !c.passed)!;
    expect(step.label).toBe("The amount is unusual compared with your last bills");
  });

  it("names missing history in plain words", () => {
    const step = checksFromTrace(gate("bills.anomaly.insufficient_history"), 3).find((c) => !c.passed)!;
    expect(step.label).toBe("There are not enough past bills to tell if the amount is usual");
  });

  it("never shows a raw rule key for the anomaly steps", () => {
    for (const r of ["bills.anomaly.over_threshold", "bills.anomaly.insufficient_history"]) {
      expect(checksFromTrace(gate(r), 3).map((c) => c.label).join(" ")).not.toMatch(/Did not pass|bills\.anomaly/);
    }
  });
});
