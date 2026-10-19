"use client";

// Subscriptions (docs/ui-direction.md §8): what I pay every month, what to cancel.
// Data: GET /api/subscriptions, GET /api/recommendations, POST /api/subscriptions/:id/keep.

import { ChatCircle } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { useState } from "react";
import recsFixture from "@/fixtures/api/recommendations.json";
import subsFixture from "@/fixtures/api/subscriptions.json";
import type {
  KeepTrialResponse,
  RecommendationItem,
  RecommendationsResponse,
  SubscriptionItem,
  SubscriptionsResponse,
} from "@/src/server/api-types";
import { postJson, useApi, useNow } from "../data";
import { dayMonth, formatMoney, relativeDays } from "../format";
import { MasterDetail, useIsDesktop } from "../components/master-detail";
import { PageHeader } from "../components/page";
import { AgentNote, Button, Money, Row, Rows, SimulatedTag, StatusBadge, Tag } from "../components/primitives";
import { SourceInfo } from "../components/source";
import { EmptyState, ErrorState, SkeletonList } from "../components/states";
import { CATEGORY_LABEL, ORIGIN_LABEL } from "../words";

type Tab = "active" | "trial" | "cancelled";
const TABS: { key: Tab; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "trial", label: "Trials" },
  { key: "cancelled", label: "Cancelled" },
];

const monthly = (s: SubscriptionItem) => s.amount.base ?? s.amount;

export function SubscriptionsScreen() {
  const subs = useApi<SubscriptionsResponse>("/api/subscriptions", subsFixture as SubscriptionsResponse);
  const recs = useApi<RecommendationsResponse>("/api/recommendations", recsFixture as RecommendationsResponse);
  const now = useNow();
  const isDesktop = useIsDesktop();
  const [tab, setTab] = useState<Tab>("active");
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const [kept, setKept] = useState<Set<string>>(new Set());

  if (subs.state === "loading" || recs.state === "loading" || !now) return <SkeletonList rows={6} />;
  if (subs.state === "error") return <ErrorState onRetry={subs.retry} />;

  const items = subs.data.items;
  const recList = recs.state === "ready" ? recs.data.items.filter((r) => r.status === "open") : [];
  const top = [...recList].sort((a, b) => b.score - a.score).filter((r) => r.score >= 3);
  const recFor = (id: string) => recList.find((r) => r.subscriptionId === id) ?? null;
  const byId = new Map(items.map((s) => [s.id, s]));
  const inTab = items.filter((s) => (tab === "active" ? s.status === "active" || s.status === "inactive" : s.status === tab));
  const yearly = items.filter((s) => s.status === "active").reduce((sum, s) => sum + s.annualCost.amount, 0);

  const selectedId = picked !== undefined ? picked : isDesktop ? (top[0]?.subscriptionId ?? inTab[0]?.id ?? null) : null;
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;

  async function keep(id: string) {
    const r = await postJson<KeepTrialResponse>(`/api/subscriptions/${id}/keep`);
    if (r.ok) setKept((k) => new Set(k).add(id));
    return r.ok;
  }

  return (
    <>
      <PageHeader
        title="Subscriptions"
        sample={subs.sample || (recs.state === "ready" && recs.sample)}
        sub={
          <>
            <span className="amount">{formatMoney({ amount: yearly, currency: subs.data.baseCurrency }, { decimals: false })}</span> a
            year across {items.filter((s) => s.status === "active").length} active subscriptions.
          </>
        }
      />
      <MasterDetail
        detailKey={selectedId ?? "none"}
        detailLabel="Subscription details"
        onClose={() => setPicked(null)}
        detail={
          selected ? (
            <SubDetail
              sub={selected}
              rec={recFor(selected.id)}
              now={now}
              kept={kept.has(selected.id) || !!selected.trial?.keepFlag}
              onKeep={keep}
            />
          ) : null
        }
        list={
          <div>
            {top.length > 0 && (
              <section aria-labelledby="h-sugg" className="mb-8">
                <h2 id="h-sugg" className="px-1 pb-2 text-[17px] font-semibold">
                  Worth a look
                </h2>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {top.map((r) => {
                    const s = byId.get(r.subscriptionId);
                    if (!s) return null;
                    return (
                      <li key={r.id}>
                        <button
                          onClick={() => setPicked(s.id)}
                          aria-pressed={selectedId === s.id}
                          className={`h-full w-full rounded-card border bg-surface p-4 text-left transition hover:border-ink ${
                            selectedId === s.id ? "border-ink" : "border-line"
                          }`}
                        >
                          <StatusBadge status="suggest" />
                          <p className="mt-3 text-[16px] font-semibold">Cancel {s.merchant.name}?</p>
                          <p className="mt-1 text-[14px] text-muted">{r.signals[0]?.detail}</p>
                          <p className="mt-3 text-[14px]">
                            Saves <Money value={r.annualSavings} decimals={false} className="font-semibold" /> a year
                          </p>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            <div role="tablist" aria-label="Filter subscriptions" className="mb-3 inline-flex rounded-full bg-sunken p-1">
              {TABS.map((t) => {
                const n = items.filter((s) => (t.key === "active" ? s.status === "active" || s.status === "inactive" : s.status === t.key)).length;
                return (
                  <button
                    key={t.key}
                    role="tab"
                    aria-selected={tab === t.key}
                    onClick={() => {
                      setTab(t.key);
                      setPicked(undefined);
                    }}
                    className={`min-h-10 rounded-full px-4 text-[14px] font-semibold transition ${
                      tab === t.key ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
                    }`}
                  >
                    {t.label} <span className="amount text-muted">{n}</span>
                  </button>
                );
              })}
            </div>

            {inTab.length === 0 ? (
              <EmptyState title={tab === "cancelled" ? "Nothing cancelled yet" : "No trials right now"}>
                {tab === "cancelled" ? "Subscriptions you cancel through Reins show up here." : "Free trials found in your bank data show up here."}
              </EmptyState>
            ) : (
              <ul className="overflow-hidden rounded-card border border-line bg-surface">
                {inTab.map((s) => (
                  <li key={s.id} className="border-b border-line last:border-b-0">
                    <button
                      onClick={() => setPicked(s.id)}
                      aria-pressed={selectedId === s.id}
                      className={`flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-sunken ${
                        selectedId === s.id ? "lg:bg-sunken" : ""
                      }`}
                    >
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sunken text-[14px] font-semibold" aria-hidden>
                        {s.merchant.name.charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[15px] font-semibold">{s.merchant.name}</span>
                          {s.priceChange && <Tag>Price went up</Tag>}
                        </span>
                        <span className="block truncate text-[13px] text-muted">{rowSub(s, now, kept.has(s.id))}</span>
                      </span>
                      <span className="text-right">
                        <Money value={monthly(s)} />
                        {s.amount.base && <span className="amount block text-[12px] text-muted">{formatMoney(s.amount)}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        }
      />
    </>
  );
}

function rowSub(s: SubscriptionItem, now: Date, kept: boolean): string {
  if (s.trial) {
    if (kept || s.trial.keepFlag) return `Trial ends ${dayMonth(s.trial.endsAt)}. You are keeping it.`;
    return s.trial.autoCancelAt
      ? `Trial ends ${dayMonth(s.trial.endsAt)}. Reins cancels it ${relativeDays(s.trial.autoCancelAt, now)}.`
      : `Trial ends ${dayMonth(s.trial.endsAt)}`;
  }
  if (s.nextRenewal) return `Renews ${dayMonth(s.nextRenewal)}`;
  return CATEGORY_LABEL[s.merchant.category] ?? s.merchant.category;
}

function SubDetail({
  sub,
  rec,
  now,
  kept,
  onKeep,
}: {
  sub: SubscriptionItem;
  rec: RecommendationItem | null;
  now: Date;
  kept: boolean;
  onKeep: (id: string) => Promise<boolean>;
}) {
  const [keepState, setKeepState] = useState<"idle" | "busy" | "failed">("idle");
  const fx = sub.amount.base;
  const unsure = sub.confidence < 0.95;

  return (
    <div>
      <p className="text-[14px] text-muted">{CATEGORY_LABEL[sub.merchant.category] ?? sub.merchant.category}</p>
      <h2 className="text-[20px] font-semibold">{sub.merchant.name}</h2>
      <div className="mt-3">
        <Money value={fx ?? sub.amount} size="lg" />
        <span className="ml-1 text-[15px] text-muted">every {sub.cycleDays} days</span>
      </div>
      {unsure && (
        <p className="mt-2 text-[14px] text-muted">We think this is a subscription, based on repeated charges in your bank data.</p>
      )}

      {rec && (
        <div className="mt-5 rounded-card bg-hint-bg p-4">
          <p className="text-[15px] font-semibold text-hint">
            Cancelling saves <Money value={rec.annualSavings} decimals={false} /> a year
          </p>
          <ul className="mt-2 space-y-2 text-[14px] text-ink">
            {rec.signals.map((sig) => (
              <li key={sig.key} className="flex flex-wrap items-center gap-2">
                {sig.detail}
                {sig.source.simulated && <SimulatedTag />}
              </li>
            ))}
          </ul>
          {rec.explanation && (
            <div className="mt-3">
              <AgentNote>{rec.explanation}</AgentNote>
            </div>
          )}
        </div>
      )}

      <div className="mt-5">
        <Rows>
          {sub.trial ? (
            <>
              <Row label="Trial ends">{dayMonth(sub.trial.endsAt)}</Row>
              <Row label="Then costs">
                <Money value={sub.amount} /> a month
              </Row>
              {sub.trial.autoCancelAt && !kept && (
                <Row label="Reins cancels">
                  {dayMonth(sub.trial.autoCancelAt)}, before the first charge
                </Row>
              )}
            </>
          ) : (
            sub.nextRenewal && (
              <Row label="Renews">
                {dayMonth(sub.nextRenewal)} <span className="text-muted">({relativeDays(sub.nextRenewal, now)})</span>
              </Row>
            )
          )}
          <Row label="A year">
            <Money value={sub.annualCost} decimals={false} />
          </Row>
          {fx && (
            <Row label="Charged in">
              <span className="amount">{formatMoney(sub.amount)}</span>{" "}
              <span className="text-muted">
                at <span className="amount">{fx.rate}</span>, rate of {dayMonth(fx.rateDate)}
              </span>
            </Row>
          )}
          {sub.priceChange && (
            <Row label="Price change">
              <Money value={sub.priceChange.from} decimals={false} /> to <Money value={sub.priceChange.to} decimals={false} /> on{" "}
              {dayMonth(sub.priceChange.at)}
            </Row>
          )}
          {sub.usage && (
            <Row label="Use">
              <span className="flex flex-wrap items-center gap-2">
                {sub.usage.sessionsPerMonth !== null ? `${sub.usage.sessionsPerMonth} ${sub.usage.sessionsPerMonth === 1 ? "time" : "times"} a month` : "No usage data"}
                {sub.usage.source.simulated && <SimulatedTag />}
              </span>
            </Row>
          )}
          <Row label="Found in">
            {ORIGIN_LABEL[sub.detectionSource === "manual" ? "user" : sub.detectionSource === "email" ? "email" : sub.detectionSource === "csv" ? "csv" : "mock_bank"]}{" "}
            <SourceInfo label="How Reins found this">
              Reins looks for charges that repeat at the same amount and interval. Numbers here come from those charges, not from
              the agent.
            </SourceInfo>
          </Row>
        </Rows>
      </div>

      <div className="mt-6 flex flex-col gap-2">
        {sub.trial && !kept && (
          <>
            {keepState === "failed" && (
              <p role="alert" className="rounded-field bg-stop-bg px-3 py-2 text-[14px] text-stop">
                That did not go through. Nothing changed. Try again.
              </p>
            )}
            <Button
              full
              variant="outline"
              disabled={keepState === "busy"}
              onClick={async () => {
                setKeepState("busy");
                setKeepState((await onKeep(sub.id)) ? "idle" : "failed");
              }}
            >
              Keep this trial
            </Button>
          </>
        )}
        {sub.trial && kept && <p className="text-[14px] text-muted">You chose to keep this trial. Reins will not cancel it.</p>}
        {sub.status === "active" && (
          <Link
            href={`/chat?ask=${encodeURIComponent(`Cancel my ${sub.merchant.name} subscription`)}`}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-ink px-5 text-[15px] font-semibold text-page hover:opacity-90"
          >
            <ChatCircle size={18} aria-hidden />
            Ask Reins to cancel
          </Link>
        )}
        {sub.status === "active" && (
          <p className="text-center text-[13px] text-muted">Reins prepares it, then asks for your OK before anything happens.</p>
        )}
      </div>
    </div>
  );
}
