"use client";

// Home (docs/ui-direction.md §8): what is coming, what needs me, the stop button.
// Mobile: dark band with one key number, light sheet with the list. Desktop: list + detail pane.

import { CaretRight, ChatCircle } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { useState } from "react";
import type { ApprovalCard, ApprovalsResponse } from "@/app/api/approvals/_lib/cards";
import summaryFixture from "@/fixtures/api/summary.json";
import type { SummaryResponse } from "@/src/server/api-types";
import { useApi, useNow } from "../data";
import { dayLabel, dayMonth, formatMoney, relativeDays } from "../format";
import { Logo } from "../components/logo";
import { MasterDetail, useIsDesktop } from "../components/master-detail";
import { Money, Row, Rows, SampleTag, StatusIcon, Tag } from "../components/primitives";
import { SourceInfo } from "../components/source";
import { ErrorState, SkeletonList } from "../components/states";
import { SAMPLE_APPROVALS } from "../sample";
import { CATEGORY_LABEL } from "../words";
import { PauseButton } from "../shell/pause";
import { ApprovalDetail, approvalHeadline, approvalSubtitle } from "./approval";

type Upcoming = SummaryResponse["upcoming14d"][number];
type Selected = { kind: "approval"; card: ApprovalCard } | { kind: "upcoming"; item: Upcoming } | null;

const KIND_LABEL: Record<Upcoming["kind"], string> = {
  bill: "Bill",
  renewal: "Subscription renews",
  trial_conversion: "Free trial ends, then paid",
  prepaid_session: "Prepaid session",
};

const baseAmount = (u: Upcoming) => u.amount.base ?? u.amount;

export function HomeScreen() {
  const summary = useApi<SummaryResponse>("/api/summary", summaryFixture as SummaryResponse);
  const approvals = useApi<ApprovalsResponse>("/api/approvals?status=pending", SAMPLE_APPROVALS);
  const [picked, setSelected] = useState<Selected | undefined>(undefined);
  const now = useNow();
  const isDesktop = useIsDesktop();

  if (summary.state === "loading" || approvals.state === "loading" || !now) {
    return (
      <div className="pt-6">
        <SkeletonList rows={6} />
      </div>
    );
  }
  if (summary.state === "error") return <div className="pt-6"><ErrorState onRetry={summary.retry} /></div>;

  const s = summary.data;
  const cards = approvals.state === "ready" ? approvals.data.items : [];
  // Desktop opens the first item that needs an OK, so the right pane is never empty.
  const selected: Selected =
    picked !== undefined ? picked : isDesktop && cards[0] ? { kind: "approval", card: cards[0] } : null;
  const sample = summary.sample || (approvals.state === "ready" && approvals.sample);
  const due14 = s.upcoming14d.reduce((sum, u) => sum + baseAmount(u).amount, 0);
  const groups = groupByDay(s.upcoming14d, now);

  const detail =
    selected?.kind === "approval" ? (
      <ApprovalDetail card={selected.card} now={now} />
    ) : selected?.kind === "upcoming" ? (
      <UpcomingDetail item={selected.item} now={now} />
    ) : null;
  const detailKey = selected?.kind === "approval" ? selected.card.id : selected?.kind === "upcoming" ? selected.item.refId : "none";

  return (
    <>
      {/* Mobile band */}
      <section className="-mx-4 bg-band px-5 pb-12 pt-[max(1rem,env(safe-area-inset-top))] text-band-ink lg:hidden">
        <div className="flex items-center justify-between">
          <Logo className="text-[22px]" symbolColor="var(--lime)" />
          <PauseButton onBand />
        </div>
        <KeyNumbers s={s} due14={due14} asks={cards.length} sample={sample} />
      </section>

      {/* Desktop header */}
      <section className="hidden rounded-card bg-band px-8 py-7 text-band-ink lg:block">
        <KeyNumbers s={s} due14={due14} asks={cards.length} sample={sample} />
      </section>

      <div className="-mx-4 -mt-6 rounded-t-card bg-page px-4 pt-5 lg:mx-0 lg:mt-8 lg:rounded-none lg:px-0 lg:pt-0">
        <MasterDetail
          detailKey={detailKey}
          detail={detail}
          onClose={() => setSelected(null)}
          list={
            <div>
              <Link
                href="/chat"
                className="mb-6 flex min-h-12 items-center gap-3 rounded-full border border-line bg-surface px-5 text-[15px] text-muted hover:text-ink"
              >
                <ChatCircle size={20} aria-hidden />
                Ask about your money
              </Link>
              {cards.length > 0 && (
                <section aria-labelledby="h-ask">
                  <h2 id="h-ask" className="px-1 pb-2 text-[17px] font-semibold">
                    Needs your OK
                  </h2>
                  <ul className="overflow-hidden rounded-card border border-line bg-surface">
                    {cards.map((c) => (
                      <ListButton
                        key={c.id}
                        selected={selected?.kind === "approval" && selected.card.id === c.id}
                        onClick={() => setSelected({ kind: "approval", card: c })}
                        icon={<StatusIcon status="ask" />}
                        title={approvalHeadline(c)}
                        sub={approvalSubtitle(c)}
                        right={c.amount ? <Money value={c.amount} /> : null}
                      />
                    ))}
                  </ul>
                </section>
              )}

              <section aria-labelledby="h-coming" className="mt-8">
                <h2 id="h-coming" className="px-1 text-[17px] font-semibold">
                  Coming up
                </h2>
                <div className="mt-2 overflow-hidden rounded-card border border-line bg-surface">
                {groups.map(([label, items]) => (
                  <div key={label} className="border-b border-line last:border-b-0">
                    <h3 className="px-4 pb-0 pt-3 text-[13px] font-semibold text-muted">{label}</h3>
                    <ul>
                      {items.map((u) => (
                        <ListButton
                          key={u.refId}
                          selected={selected?.kind === "upcoming" && selected.item.refId === u.refId}
                          onClick={() => setSelected({ kind: "upcoming", item: u })}
                          title={u.title}
                          sub={KIND_LABEL[u.kind]}
                          right={
                            <span className="text-right">
                              <Money value={baseAmount(u)} />
                              {u.amount.base && (
                                <span className="amount block text-[12px] text-muted">{formatMoney(u.amount)}</span>
                              )}
                            </span>
                          }
                        />
                      ))}
                    </ul>
                  </div>
                ))}
                </div>
              </section>

              <ThisMonth s={s} />
            </div>
          }
        />
      </div>
    </>
  );
}

function KeyNumbers({ s, due14, asks, sample }: { s: SummaryResponse; due14: number; asks: number; sample: boolean }) {
  return (
    <div className="mt-8 lg:mt-0 lg:flex lg:items-end lg:justify-between lg:gap-8">
      <div>
        <p className="flex items-center gap-2 text-[14px] text-band-muted">
          Due in the next 14 days
          {sample && <SampleTag />}
        </p>
        <Money value={{ amount: due14, currency: s.baseCurrency }} size="xl" className="mt-2 block" mutedClass="text-band-muted" />
        <p className="mt-3 text-[15px]">
          {asks > 0 ? (
            <span className="font-semibold text-lime">
              {asks} {asks === 1 ? "needs" : "need"} your OK
            </span>
          ) : (
            <span className="text-band-muted">Nothing needs your OK</span>
          )}
        </p>
      </div>
      <dl className="mt-6 grid grid-cols-2 gap-6 border-t border-white/10 pt-4 lg:mt-0 lg:border-0 lg:pt-0">
        <div>
          <dt className="text-[13px] text-band-muted">In your account</dt>
          <dd>
            <Money value={s.balance} size="md" decimals={false} />
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-[13px] text-band-muted">
            Left after bills
            <SourceInfo label="How this is worked out">
              Your balance minus every bill and subscription due before the end of the month. Worked out by Reins from your
              bank data, not guessed.
            </SourceInfo>
          </dt>
          <dd>
            <Money value={s.balanceAfterObligations} size="md" decimals={false} />
          </dd>
        </div>
      </dl>
    </div>
  );
}

function ListButton({
  title,
  sub,
  right,
  icon,
  selected,
  onClick,
}: {
  title: string;
  sub: string;
  right: React.ReactNode;
  icon?: React.ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <li className="border-b border-line last:border-b-0 [h3+ul>&]:border-b-0">
      <button
        onClick={onClick}
        aria-pressed={selected}
        className={`flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-sunken ${selected ? "lg:bg-sunken" : ""}`}
      >
        {icon}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold">{title}</span>
          <span className="block truncate text-[13px] text-muted">{sub}</span>
        </span>
        {right}
        <CaretRight size={16} className="shrink-0 text-muted lg:hidden" aria-hidden />
      </button>
    </li>
  );
}

function UpcomingDetail({ item, now }: { item: Upcoming; now: Date }) {
  const fx = item.amount.base;
  return (
    <div>
      <p className="text-[14px] text-muted">{KIND_LABEL[item.kind]}</p>
      <h2 className="text-[20px] font-semibold">{item.title}</h2>
      <div className="mt-4">
        <Money value={fx ?? item.amount} size="lg" />
      </div>
      <div className="mt-4">
        <Rows>
          <Row label="When">
            {dayMonth(item.dueDate)} <span className="text-muted">({relativeDays(item.dueDate, now)})</span>
          </Row>
          {fx && (
            <Row label="Charged in">
              <span className="amount">{formatMoney(item.amount)}</span>{" "}
              <span className="text-muted">
                at <span className="amount">{fx.rate}</span>, rate of {dayMonth(fx.rateDate)}
              </span>
            </Row>
          )}
          <Row label="Data from">
            Bank <Tag className="ml-1">Mock bank</Tag>
          </Row>
        </Rows>
      </div>
      <p className="mt-4 text-[14px] text-muted">
        {item.kind === "bill"
          ? "Reins checks this bill against your rules before paying. If it is over your auto-pay limit, it asks you first."
          : item.kind === "trial_conversion"
            ? "Your rules cancel free trials before the first charge, unless you choose to keep it on the Subscriptions screen."
            : "Reins tells you before every renewal. You can cancel it on the Subscriptions screen."}
      </p>
    </div>
  );
}

function ThisMonth({ s }: { s: SummaryResponse }) {
  const max = Math.max(...s.byCategory.map((c) => c.amount.amount), 1);
  return (
    <section aria-labelledby="h-month" className="mt-8">
      <h2 id="h-month" className="px-1 text-[17px] font-semibold">
        This month
      </h2>
      <div className="mt-3 rounded-card border border-line bg-surface p-5">
        <div className="flex flex-wrap gap-x-10 gap-y-3">
          <div>
            <p className="text-[13px] text-muted">Money in</p>
            <Money value={s.income} size="md" decimals={false} />
          </div>
          <div>
            <p className="text-[13px] text-muted">Spent so far</p>
            <Money value={s.spending} size="md" decimals={false} />
          </div>
          <div>
            <p className="text-[13px] text-muted">Bills and subscriptions</p>
            <Money
              value={{ amount: s.recurring.bills.amount + s.recurring.subscriptions.amount, currency: s.baseCurrency }}
              size="md"
              decimals={false}
            />
          </div>
        </div>
        <ul className="mt-5 space-y-3">
          {s.byCategory.map((c) => (
            <li key={c.category} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-3 text-[14px]">
              <span>{CATEGORY_LABEL[c.category] ?? c.category}</span>
              <span className="h-1.5 rounded-full bg-ink/80" style={{ width: `${(c.amount.amount / max) * 100}%` }} aria-hidden />
              <Money value={c.amount} decimals={false} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function groupByDay(items: Upcoming[], now: Date): [string, Upcoming[]][] {
  const out = new Map<string, Upcoming[]>();
  for (const u of [...items].sort((a, b) => a.dueDate.localeCompare(b.dueDate))) {
    const key = dayLabel(u.dueDate, now);
    out.set(key, [...(out.get(key) ?? []), u]);
  }
  return [...out.entries()];
}
