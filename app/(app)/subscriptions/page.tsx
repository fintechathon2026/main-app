"use client";

// Subscriptions and recommendations (PRD §18.1 #6, R4-08). Trials get "keep it" (FR5.7);
// cancellation goes through chat so it is planned, gated and approved like any other action.

import Link from "next/link";
import { useState } from "react";
import type { KeepTrialResponse, RecommendationItem, RecommendationsResponse, SubscriptionItem, SubscriptionsResponse } from "@/src/server/api-types";
import { Badge, Button, Card, Empty, ErrorNote, SectionTitle, Skeleton, SourceTag } from "../../_components/ui";
import { apiFetch } from "../../_lib/api";
import { date, fxNote, money } from "../../_lib/format";
import { useApi } from "../../_lib/use-api";

const STATUS_TONE: Record<SubscriptionItem["status"], "ok" | "neutral" | "warn" | "danger"> = {
  active: "ok",
  trial: "warn",
  inactive: "neutral",
  cancelled: "danger",
};

const SIGNAL_LABEL: Record<RecommendationItem["signals"][number]["key"], string> = {
  duplicate: "Duplicate",
  price_increase: "Price up",
  trial_converted: "Trial converted",
  low_usage: "Low usage",
  fx_cost_high: "FX cost",
  high_share: "Large share",
};

export default function SubscriptionsPage() {
  const subs = useApi<SubscriptionsResponse>("/api/subscriptions");
  const recs = useApi<RecommendationsResponse>("/api/recommendations");
  const byId = new Map((subs.data?.items ?? []).map((s) => [s.id, s]));
  const open = (recs.data?.items ?? []).filter((r) => r.status === "open").sort((a, b) => b.score - a.score);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Subscriptions</h1>
        <p className="text-sm text-grey-500">Detected from your bank feed. We think these are recurring until you confirm.</p>
      </header>

      <Card>
        <SectionTitle>Recommendations</SectionTitle>
        {recs.error ? (
          <ErrorNote error={recs.error} />
        ) : !recs.data ? (
          <Skeleton />
        ) : open.length === 0 ? (
          <Empty>No suggestions right now.</Empty>
        ) : (
          <ul className="space-y-3">
            {open.map((r) => (
              <RecommendationRow key={r.id} rec={r} sub={byId.get(r.subscriptionId)} />
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <SectionTitle>All subscriptions</SectionTitle>
        {subs.error ? (
          <ErrorNote error={subs.error} />
        ) : !subs.data ? (
          <Skeleton lines={5} />
        ) : subs.data.items.length === 0 ? (
          <Empty>No subscriptions detected yet. Connect the sandbox bank to start.</Empty>
        ) : (
          <ul className="divide-y divide-grey-100">
            {subs.data.items.map((s) => (
              <SubscriptionRow key={s.id} sub={s} onKept={subs.reload} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function RecommendationRow({ rec, sub }: { rec: RecommendationItem; sub?: SubscriptionItem }) {
  const name = sub?.merchant.name ?? "Subscription";
  return (
    <li className="rounded-xl bg-grey-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Consider cancelling {name}</div>
          <div className="text-xs text-grey-500">Score {rec.score}</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold text-ok">save {money(rec.annualSavings)}</div>
          <div className="text-[11px] text-grey-500">per year</div>
        </div>
      </div>
      <ul className="mt-2 space-y-1">
        {rec.signals.map((sig) => (
          <li key={sig.key} className="flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
            <Badge tone="lavender">
              {SIGNAL_LABEL[sig.key]} +{sig.points}
            </Badge>
            {sig.detail}
            <SourceTag source={sig.source} />
          </li>
        ))}
      </ul>
      {rec.explanation ? <p className="mt-2 text-xs italic text-grey-500">Agent note: {rec.explanation}</p> : null}
      <div className="mt-3">
        <Link
          href={`/chat?prompt=${encodeURIComponent(`Cancel my ${name} subscription`)}`}
          className="inline-flex min-h-11 items-center rounded-xl bg-surface px-4 text-sm font-semibold ring-1 ring-grey-300 hover:bg-lime"
        >
          Ask Reins to cancel
        </Link>
      </div>
    </li>
  );
}

function SubscriptionRow({ sub, onKept }: { sub: SubscriptionItem; onKept: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fx = fxNote(sub.amount);

  async function keep() {
    setBusy(true);
    setErr(null);
    try {
      await apiFetch<KeepTrialResponse>(`/api/subscriptions/${sub.id}/keep`, { method: "POST" });
      onKept();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold">{sub.merchant.name}</span>
            <Badge tone={STATUS_TONE[sub.status]}>{sub.status}</Badge>
            {sub.amount.currency !== "CNY" ? <Badge tone="lavender">{sub.amount.currency}</Badge> : null}
          </div>
          <div className="mt-0.5 text-xs text-grey-500">
            every {sub.cycleDays} days · next {date(sub.nextRenewal)} · {money(sub.annualCost)}/yr
          </div>
          {sub.priceChange ? (
            <div className="mt-1 text-xs text-warn">
              Price changed {money(sub.priceChange.from)} → {money(sub.priceChange.to)} on {date(sub.priceChange.at)}
            </div>
          ) : null}
          {sub.usage ? (
            <div className="mt-1 flex items-center gap-1.5 text-xs text-grey-500">
              {sub.usage.sessionsPerMonth ?? "?"} uses / month <SourceTag source={sub.usage.source} />
            </div>
          ) : (
            <div className="mt-1 text-xs text-grey-500">No usage data</div>
          )}
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold">{money(sub.amount)}</div>
          {fx ? <div className="text-[11px] text-grey-500">{fx}</div> : null}
        </div>
      </div>
      {sub.trial ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-warn-soft px-3 py-2 text-xs">
          <span>
            Trial ends {date(sub.trial.endsAt)}.{" "}
            {sub.trial.keepFlag ? "You chose to keep it." : sub.trial.autoCancelAt ? `Reins will cancel it on ${date(sub.trial.autoCancelAt)} unless you keep it.` : "Not set to auto-cancel."}
          </span>
          {!sub.trial.keepFlag ? (
            <Button variant="secondary" className="min-h-9 px-3 text-xs" disabled={busy} onClick={keep}>
              {busy ? "Saving…" : "Keep it"}
            </Button>
          ) : null}
          {err ? <span className="w-full text-danger">{err}</span> : null}
        </div>
      ) : null}
    </li>
  );
}
