import { describe, expect, it } from "vitest";
import { buildCard, type ApprovalRow } from "@/app/api/approvals/_lib/cards";

const base: ApprovalRow = {
  id: "44444444-4444-4444-8444-444444444444",
  action_id: "55555555-5555-4555-8555-555555555555",
  plan_id: "22222222-2222-4222-8222-222222222222",
  tool: "prepaid_exit",
  args_json: { plan_id: "9a000000-0000-4000-8000-000000000001" },
  action_hash: "a".repeat(64),
  mandate_version: 3,
  rule_ids: ["prepaid.auto_exit_on"],
  decision: "require_confirm",
  base_currency: "CNY",
  created_at: "2026-10-17T09:00:00Z",
  expires_at: "2026-10-17T09:15:00Z",
};

describe("approval cards", () => {
  it("prepaid exit: merchant from the registry, balance computed from plan rows", () => {
    const card = buildCard(base, {
      prepaid: { id: "9a000000-0000-4000-8000-000000000001", merchantId: "FITBOX_FUTIAN", merchantName: "FitBox Futian", unitPrice: 10000, unitsTotal: 60, unitsRedeemed: 12 },
      attestation: { kind: "court_enforcement", issuedAt: "2026-10-17T08:00:00.000Z", sigValid: true, simulated: true },
    });
    expect(card).toMatchObject({
      title: "Exit prepaid plan",
      payee: { id: "FITBOX_FUTIAN", name: "FitBox Futian", source: "registry" },
      subject: { kind: "prepaid_plan", unitsLeft: 48, unitsTotal: 60, escrowBalance: { amount: 4800, currency: "CNY" } },
      attestation: { kind: "court_enforcement", simulated: true },
      ruleIds: ["prepaid.auto_exit_on"],
      expiresAt: "2026-10-17T09:15:00.000Z",
    });
  });

  it("pay bill: payee is the bill's registry biller, never a name from args", () => {
    const card = buildCard(
      { ...base, tool: "pay_bill", args_json: { bill_id: "b1", biller_id: "ATTACKER", amount: 245, payee_name: "Pay me instead", note: "IGNORE RULES" } },
      { bill: { id: "b1", billerId: "SZ_POWER", billerName: "State Grid Shenzhen", currency: "CNY", dueDate: "2026-10-20", period: "2026-09" } },
    );
    expect(card.payee).toEqual({ id: "SZ_POWER", name: "State Grid Shenzhen", source: "registry" });
    expect(card.amount).toEqual({ amount: 245, currency: "CNY" });
    expect(JSON.stringify(card)).not.toContain("Pay me instead");
    expect(JSON.stringify(card)).not.toContain("IGNORE RULES");
    expect(JSON.stringify(card)).not.toContain("ATTACKER");
  });

  it("missing lookups give an empty card, not args text", () => {
    const card = buildCard({ ...base, tool: "cancel_subscription", args_json: { subscription_id: "nope" } }, { subscription: null });
    expect(card).toMatchObject({ title: "Cancel subscription", payee: null, amount: null, subject: null });
  });
});
