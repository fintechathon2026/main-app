// get_balance, list_transactions, list_bills (architecture §6.4, PRD §14.2).

import { z } from "zod";
import { roundBase } from "@/src/core/algorithms/money";
import { daysBetween } from "@/src/core/detectors/stats";
import type { Labeled } from "@/src/core/types";
import { billOrigin } from "@/src/server/db/read/bills";
import { defineReadTool, zDate } from "./define";

export const MAX_RANGE_DAYS = 400;

export const getBalance = defineReadTool({
  name: "get_balance",
  description: "Current account balances from the bank, plus the total in the user's base currency.",
  args: z.object({}).strict(),
  async run(_a, d): Promise<Labeled<unknown>> {
    const [accounts, settings] = await Promise.all([d.repos.accounts(d.userId), d.repos.settings(d.userId)]);
    const base = settings.baseCurrency;
    return {
      origin: "mock_bank",
      value: {
        accounts: accounts.map((a) => ({ id: a.id, type: a.type, currency: a.currency, balance: a.balance, updatedAt: a.updated_at })),
        total: { amount: roundBase(accounts.filter((a) => a.currency === base).reduce((s, a) => s + a.balance, 0)), currency: base },
      },
    };
  },
});

export const listTransactions = defineReadTool({
  name: "list_transactions",
  description:
    "Transactions between two dates (inclusive, YYYY-MM-DD, at most 400 days), optionally filtered by merchant name or id. Negative amounts are money out.",
  args: z
    .object({ from: zDate, to: zDate, merchant: z.string().min(1).max(100).optional() })
    .strict()
    .refine((a) => a.from <= a.to && daysBetween(a.from, a.to) <= MAX_RANGE_DAYS, { message: "from must be ≤ to, range ≤ 400 days" }),
  async run(a, d): Promise<Labeled<unknown>[]> {
    const rows = await d.repos.transactions(d.userId, { from: a.from, to: a.to, merchant: a.merchant ?? null });
    return rows.map((t) => ({
      origin: t.origin,
      sourceId: t.source_id ?? t.id,
      value: {
        id: t.id,
        date: t.posted_at.slice(0, 10),
        amount: t.amount,
        currency: t.currency,
        merchant: t.merchant_name,
        merchantId: t.merchant_id,
        category: t.category,
        original: t.original_currency ? { amount: t.original_amount, currency: t.original_currency, fxRate: t.fx_rate, fxRateDate: t.fx_rate_date } : null,
      },
    }));
  },
});

export const listBills = defineReadTool({
  name: "list_bills",
  description: "Bills with biller name, amount, due date and status. Optionally filter by status (for example pending or paid).",
  args: z.object({ status: z.string().regex(/^[a-z_]{1,32}$/).optional() }).strict(),
  async run(a, d): Promise<Labeled<unknown>[]> {
    const [rows, settings] = await Promise.all([d.repos.bills(d.userId, a.status ?? null), d.repos.settings(d.userId)]);
    return rows.map((b) => ({
      origin: billOrigin(b),
      sourceId: b.document_id ?? b.id,
      value: {
        id: b.id,
        billerId: b.biller_id,
        billerName: b.biller_name ?? b.biller_id,
        amount: b.amount,
        currency: settings.baseCurrency,
        dueDate: b.due_date,
        period: b.period,
        status: b.status,
      },
    }));
  },
});
