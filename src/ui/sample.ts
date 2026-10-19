// Sample data for routes that are not built or not reachable yet. Every screen that shows it
// says "Sample data" next to the title. The shapes for feed, mandate history and audit are
// provisional UI-side types: when R2/R3 add the routes and types to src/server/api-types.ts,
// switch the screens to those types and delete the matching sample here.
// Values follow Lin's seed (supabase/seed.sql, LIN_MANDATE_V3) and fixtures/api/*.json.

import type { ApprovalsResponse } from "@/app/api/approvals/_lib/cards";
import type { Origin } from "@/src/core/types";
import type { Status } from "./words";

const ZERO_HASH = "0x" + "0".repeat(64);

// ---- GET /api/approvals?status=pending (route exists, needs a session) ---------------------

export const SAMPLE_APPROVALS: ApprovalsResponse = {
  items: [
    {
      id: "a0000000-0000-4000-8000-000000000001",
      actionId: "ac000000-0000-4000-8000-000000000001",
      planId: "91000000-0000-4000-8000-000000000001",
      tool: "pay_bill",
      title: "Pay bill",
      payee: { id: "LANDLORD_WANG", name: "Landlord Wang", source: "registry" },
      amount: { amount: 3500, currency: "CNY" },
      subject: { kind: "bill", id: "b1000000-0000-4000-8000-000000000004", dueDate: "2026-10-28", period: "2026-10" },
      attestation: null,
      decision: "require_confirm",
      ruleIds: ["payees.allow", "bills.over_auto_pay_max"],
      mandateVersion: 3,
      actionHash: "0x7d2c9a41e0b35f8c6a1d4e92b07f3c5a8e1d6b29f40c7a3e5b8d1f2c6a9e0b47",
      createdAt: "2026-10-19T01:12:00.000Z",
      expiresAt: "2026-10-20T01:12:00.000Z",
    },
    {
      id: "a0000000-0000-4000-8000-000000000002",
      actionId: "ac000000-0000-4000-8000-000000000002",
      planId: "91000000-0000-4000-8000-000000000002",
      tool: "cancel_subscription",
      title: "Cancel subscription: iQIYI",
      payee: null,
      amount: { amount: 30, currency: "CNY" },
      subject: { kind: "subscription", id: "5b000000-0000-4000-8000-000000000002", nextRenewal: "2026-11-05", status: "active" },
      attestation: null,
      decision: "require_confirm",
      ruleIds: ["subscriptions.cancel_needs_confirm"],
      mandateVersion: 3,
      actionHash: "0x1b8e4f0a92c7d35e6f1a08b4c92d7e3f5a6b0c18d2e94f7a3b5c6d8e0f1a2b39",
      createdAt: "2026-10-19T02:40:00.000Z",
      expiresAt: "2026-10-21T02:40:00.000Z",
    },
  ],
};

// ---- GET /api/feed (not built yet: R2) -----------------------------------------------------

export type FeedItem = {
  id: string;
  at: string;
  status: Status;
  title: string;
  detail: string;
  amount?: { amount: number; currency: string };
  ruleIds: string[];
  mandateVersion: number;
  origins: { origin: Origin; label: string; simulated?: boolean }[];
  /** "Why?" trace: the Rule check steps in order, plain words. */
  checks: { label: string; passed: boolean }[];
  tx?: { hash: string; explorerUrl: string };
  agentNote?: string;
};

export const SAMPLE_FEED: FeedItem[] = [
  {
    id: "f1",
    at: "2026-10-19T02:40:00.000Z",
    status: "suggest",
    title: "Cancel iQIYI?",
    detail: "You used it once this month and also pay for NetEase Cloud Music. Saves ¥360 a year.",
    amount: { amount: 30, currency: "CNY" },
    ruleIds: ["subscriptions.cancel_needs_confirm"],
    mandateVersion: 3,
    origins: [
      { origin: "mock_bank", label: "Bank: monthly charge ¥30" },
      { origin: "simulated", label: "Usage: 1 time this month", simulated: true },
    ],
    checks: [
      { label: "Your rules are signed and current (version 3)", passed: true },
      { label: "Cancelling a subscription needs your OK", passed: true },
    ],
  },
  {
    id: "f2",
    at: "2026-10-19T01:12:00.000Z",
    status: "ask",
    title: "Rent to Landlord Wang",
    detail: "¥3,500 is over your auto-pay limit of ¥300, so it waits for your OK.",
    amount: { amount: 3500, currency: "CNY" },
    ruleIds: ["payees.allow", "bills.over_auto_pay_max"],
    mandateVersion: 3,
    origins: [
      { origin: "registry", label: "Payee: Landlord Wang (saved payee)" },
      { origin: "mock_bank", label: "Bill: due 28 Oct" },
    ],
    checks: [
      { label: "Your rules are signed and current (version 3)", passed: true },
      { label: "Landlord Wang is a saved payee", passed: true },
      { label: "¥3,500 is over your auto-pay limit of ¥300", passed: false },
    ],
  },
  {
    id: "f3",
    at: "2026-10-18T09:05:00.000Z",
    status: "blocked",
    title: "Payment to a new account",
    detail: "An emailed bill asked to pay a different account for electricity. It is not one of your saved payees, so nothing was paid.",
    amount: { amount: 186, currency: "CNY" },
    ruleIds: ["payees.not_allowed"],
    mandateVersion: 3,
    origins: [{ origin: "email", label: "Email: bill PDF (not trusted for payments)" }],
    checks: [
      { label: "Your rules are signed and current (version 3)", passed: true },
      { label: "The account is not in your saved payees", passed: false },
    ],
    agentNote: "The PDF looked like State Grid Shenzhen but listed a different bank account.",
  },
  {
    id: "f4",
    at: "2026-10-18T08:30:00.000Z",
    status: "done",
    title: "China Mobile paid",
    detail: "¥88 paid 2 days before it was due.",
    amount: { amount: 88, currency: "CNY" },
    ruleIds: ["payees.allow", "bills.auto_pay_max"],
    mandateVersion: 3,
    origins: [
      { origin: "registry", label: "Payee: China Mobile (saved payee)" },
      { origin: "mock_bank", label: "Bill: due 20 Oct" },
    ],
    checks: [
      { label: "Your rules are signed and current (version 3)", passed: true },
      { label: "China Mobile is a saved payee", passed: true },
      { label: "¥88 is under your auto-pay limit of ¥300", passed: true },
      { label: "Today's total stays under your daily limit of ¥1,000", passed: true },
    ],
  },
  {
    id: "f5",
    at: "2026-10-16T03:00:00.000Z",
    status: "done",
    title: "Reminder sent: Keep Premium trial",
    detail: "Your free trial ends on 19 Oct. Reins will cancel it on 18 Oct unless you keep it.",
    ruleIds: ["subscriptions.auto_cancel_trials"],
    mandateVersion: 3,
    origins: [{ origin: "mock_bank", label: "Bank: trial sign-up on 19 Sep" }],
    checks: [{ label: "Free trials are cancelled before the first charge", passed: true }],
  },
  {
    id: "f6",
    at: "2026-10-15T11:30:00.000Z",
    status: "done",
    title: "FitBox session 12 used",
    detail: "¥100 released to FitBox Futian after you and the gym both signed.",
    amount: { amount: 100, currency: "CNY" },
    ruleIds: ["prepaid.redeem"],
    mandateVersion: 3,
    origins: [{ origin: "chain", label: "Blockchain: test network" }],
    checks: [
      { label: "You and the gym both signed session 12", passed: true },
      { label: "Exactly one session price was released", passed: true },
    ],
    tx: {
      hash: "0x5e1f7a2c5e1f7a2c5e1f7a2c5e1f7a2c5e1f7a2c5e1f7a2c5e1f7a2c00000070",
      explorerUrl: "https://sepolia.basescan.org/tx/0x5e1f7a2c5e1f7a2c5e1f7a2c5e1f7a2c5e1f7a2c5e1f7a2c5e1f7a2c00000070",
    },
  },
];

// ---- GET /api/mandates/active, /history (not built yet: R2) --------------------------------

export type MandateVersion = { version: number; signedAt: string; change: string; direction: "less" | "more" | "first" };

export const SAMPLE_MANDATE_HISTORY: MandateVersion[] = [
  { version: 3, signedAt: "2026-10-12T06:20:00.000Z", change: "Added rules for prepaid packages", direction: "more" },
  { version: 2, signedAt: "2026-10-05T10:02:00.000Z", change: "Auto-pay limit lowered from ¥500 to ¥300", direction: "less" },
  { version: 1, signedAt: "2026-10-01T09:15:00.000Z", change: "First rules signed", direction: "first" },
];

// ---- GET /api/audit/verify and the record (not built yet: R3) ------------------------------

export type AuditRow = {
  seq: number;
  at: string;
  event: string;
  actor: "agent" | "user" | "system";
  status: Status | null;
  ruleIds: string[];
  hash: string;
  tx?: { hash: string; explorerUrl: string };
};

export const SAMPLE_AUDIT: { chainOk: boolean; checkedAt: string; rows: AuditRow[] } = {
  chainOk: true,
  checkedAt: "2026-10-19T03:00:00.000Z",
  rows: [
    { seq: 48, at: "2026-10-19T02:40:00.000Z", event: "Suggested: cancel iQIYI", actor: "agent", status: "suggest", ruleIds: ["subscriptions.cancel_needs_confirm"], hash: "0x91c4a2e07b3d5f1e8a6c2d940b7e3f15a8c6d2e0f4b1a3c5d7e9f0a2b4c6d8e1" },
    { seq: 47, at: "2026-10-19T01:12:00.000Z", event: "Asked for OK: rent ¥3,500", actor: "agent", status: "ask", ruleIds: ["bills.over_auto_pay_max"], hash: "0x4f2b8e1a6c9d03e5b7a1f4c82d6e9b0a3c5e7f1d2b4a6c8e0f2a4b6c8d0e2f43" },
    { seq: 46, at: "2026-10-18T09:05:00.000Z", event: "Blocked: payment to an account not in saved payees", actor: "agent", status: "blocked", ruleIds: ["payees.not_allowed"], hash: "0xa7d3c1e95f2b480e6c1a3d7f9b2e4c60a8d1f3b5c7e9a0b2d4f6a8c0e2b4d6f8" },
    { seq: 45, at: "2026-10-18T08:30:00.000Z", event: "Paid China Mobile ¥88", actor: "agent", status: "done", ruleIds: ["bills.auto_pay_max"], hash: "0x2e6a9c0d4b8f13e7a5c2d9f6b0e3a8c1d5f7b9e2a4c6d8f0b2e4a6c8d0f2b4e6" },
    { seq: 44, at: "2026-10-16T03:00:00.000Z", event: "Reminder sent: Keep Premium trial", actor: "system", status: "done", ruleIds: ["subscriptions.auto_cancel_trials"], hash: "0xc5e1b9a3d7f20c4e8b6a1d3f5c7e9b0a2d4f6c8e0a1b3d5f7c9e1a2b4d6f8c0e" },
    {
      seq: 43,
      at: "2026-10-15T11:30:00.000Z",
      event: "FitBox session 12 released ¥100",
      actor: "user",
      status: "done",
      ruleIds: ["prepaid.redeem"],
      hash: "0x6b0d4f8a2c1e3579b0d2f4a6c8e1b3d5f7a9c0e2b4d6f8a1c3e5b7d9f0a2c4e7",
      tx: {
        hash: "0x5e1f7a2c5e1f7a2c5e1f7a2c5e1f7a2c5e1f7a2c5e1f7a2c5e1f7a2c00000070",
        explorerUrl: "https://sepolia.basescan.org/tx/0x5e1f7a2c5e1f7a2c5e1f7a2c5e1f7a2c5e1f7a2c5e1f7a2c5e1f7a2c00000070",
      },
    },
    { seq: 1, at: "2026-10-01T09:15:00.000Z", event: "Rules signed (version 1)", actor: "user", status: null, ruleIds: [], hash: ZERO_HASH.slice(0, 60) + "9a1c" },
  ],
};
