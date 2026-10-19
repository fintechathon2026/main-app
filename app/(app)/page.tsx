"use client";

// Home (PRD §18.1 #1 and #9): balance, next 14 days, waiting approvals, insights.

import Link from "next/link";
import type { SummaryResponse } from "@/src/server/api-types";
import type { ApprovalsResponse } from "@/app/api/approvals/_lib/cards";
import { Badge, Card, Empty, ErrorNote, SectionTitle, Skeleton, Stat } from "../_components/ui";
import { date, fxNote, money } from "../_lib/format";
import { useApi } from "../_lib/use-api";

const KIND_LABEL: Record<SummaryResponse["upcoming14d"][number]["kind"], { label: string; tone: "neutral" | "lavender" | "warn" | "lime" }> = {
  bill: { label: "Bill", tone: "neutral" },
  renewal: { label: "Renewal", tone: "lavender" },
  trial_conversion: { label: "Trial ends", tone: "warn" },
  prepaid_session: { label: "Prepaid", tone: "lime" },
};

export default function HomePage() {
  const summary = useApi<SummaryResponse>("/api/summary");
  const approvals = useApi<ApprovalsResponse>("/api/approvals?status=pending", { pollMs: 10_000 });
  const s = summary.data;
  const pending = approvals.data?.items ?? [];

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm text-grey-500">Good to see you, Lin</p>
        <h1 className="text-2xl font-semibold tracking-tight">Your money, on a short rein</h1>
      </header>

      {pending.length > 0 ? (
        <Link href="/approvals" className="flex items-center justify-between gap-3 rounded-2xl bg-ink px-4 py-4 text-white">
          <span>
            <span className="block text-sm font-semibold">
              {pending.length} {pending.length === 1 ? "action needs" : "actions need"} your approval
            </span>
            <span className="block text-xs text-grey-300">Nothing moves until you approve it.</span>
          </span>
          <span className="rounded-lg bg-lime px-3 py-1.5 text-sm font-semibold text-ink">Review</span>
        </Link>
      ) : null}

      <Card>
        {summary.error ? (
          <ErrorNote error={summary.error} />
        ) : !s ? (
          <Skeleton />
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Balance" value={money(s.balance)} />
            <Stat label="After obligations" value={money(s.balanceAfterObligations)} hint="next 14 days" />
            <Stat label={`Income · ${s.period}`} value={money(s.income)} />
            <Stat label={`Spending · ${s.period}`} value={money(s.spending)} />
          </div>
        )}
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <SectionTitle>Next 14 days</SectionTitle>
          {!s ? (
            summary.error ? null : <Skeleton lines={4} />
          ) : s.upcoming14d.length === 0 ? (
            <Empty>Nothing due in the next two weeks.</Empty>
          ) : (
            <ul className="divide-y divide-grey-100">
              {s.upcoming14d.map((u) => {
                const k = KIND_LABEL[u.kind];
                const fx = fxNote(u.amount);
                return (
                  <li key={`${u.kind}-${u.refId}`} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{u.title}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-grey-500">
                        <Badge tone={k.tone}>{k.label}</Badge>
                        {date(u.dueDate)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold">{money(u.amount)}</div>
                      {fx ? <div className="text-[11px] text-grey-500">{fx}</div> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <SectionTitle>Insights</SectionTitle>
          {!s ? (
            summary.error ? null : <Skeleton lines={4} />
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Recurring bills" value={money(s.recurring.bills)} hint="per month" />
                <Stat label="Subscriptions" value={money(s.recurring.subscriptions)} hint="per month" />
              </div>
              <ul className="space-y-2">
                {s.insights.map((i) => (
                  <li key={i.key} className="rounded-xl bg-grey-50 px-3 py-2 text-sm leading-relaxed" title={`Source: ${i.refIds.length} record(s)`}>
                    {i.text}
                  </li>
                ))}
              </ul>
              <div>
                <div className="mb-1.5 text-xs text-grey-500">Spending by category</div>
                <CategoryBars items={s.byCategory} total={s.spending.amount} />
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function CategoryBars({ items, total }: { items: SummaryResponse["byCategory"]; total: number }) {
  if (total <= 0) return <Empty>No spending yet this month.</Empty>;
  return (
    <ul className="space-y-1.5">
      {items.map((c) => (
        <li key={c.category} className="text-xs" title={`${c.transactionIds.length} transaction(s)`}>
          <div className="flex justify-between">
            <span className="capitalize text-ink-soft">{c.category.replaceAll("_", " ")}</span>
            <span className="font-medium">{money(c.amount)}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-grey-100">
            <div className="h-1.5 rounded-full bg-lime-strong" style={{ width: `${Math.min(100, (c.amount.amount / total) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
