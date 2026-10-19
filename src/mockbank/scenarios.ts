// Owner: R3 (roles.md). Minimal version by R1; extend, don't duplicate.
// Named test scenarios for POST /mockbank/test/scenarios/:name (PRD §14.1). Each scenario
// changes the bank's own state and emits events; the app picks them up via GET /events.

import { MockbankError, injectBill, injectTransaction, setDefaultBalance, setTrialEnd } from "./bank";

type Params = Record<string, unknown>;
type Scenario = { description: string; run: (customerId: string, p: Params) => Promise<unknown> };

const str = (v: unknown, name: string) => {
  if (typeof v !== "string" || !v) throw new MockbankError(400, `missing_${name}`);
  return v;
};
const int = (v: unknown, fallback: number) => (Number.isInteger(v) ? (v as number) : fallback);

export const scenarios: Record<string, Scenario> = {
  new_bill: {
    description: "Issue a new bill: {biller_id, amount, due_in_days?}",
    run: (c, p) => injectBill(c, { biller_id: str(p.biller_id, "biller_id"), amount: int(p.amount, 0), due_in_days: int(p.due_in_days, 3) }),
  },
  anomalous_electricity: {
    description: "Issue an anomalous ¥612 SZ_POWER bill",
    run: (c, p) => injectBill(c, { biller_id: "SZ_POWER", amount: int(p.amount, 612), due_in_days: 3 }),
  },
  trial_converting: {
    description: "Move a trial's conversion to {in_hours} (default 48): {subscription_id}",
    run: (c, p) => setTrialEnd(c, str(p.subscription_id, "subscription_id"), int(p.in_hours, 48)),
  },
  low_balance: {
    description: "Set the default account balance: {balance} (default 50)",
    run: (c, p) => setDefaultBalance(c, typeof p.balance === "number" ? p.balance : 50),
  },
  payday: {
    description: "Post an income transaction that triggers payday and sweeps: {amount?} (default 15000), {descriptor?}",
    run: (c, p) => {
      const amount = int(p.amount, 15000);
      if (amount <= 0) throw new MockbankError(400, "invalid_amount");
      const descriptor = typeof p.descriptor === "string" && p.descriptor ? p.descriptor : "SALARY SHENZHEN TECH";
      // Salary lands in the default account, so a following sweep has the money to move.
      return injectTransaction(c, { amount, descriptor }, { applyToBalance: true });
    },
  },
};

/** GET /mockbank/test/scenarios */
export function listScenarios() {
  return Object.entries(scenarios).map(([name, s]) => ({ name, description: s.description }));
}
