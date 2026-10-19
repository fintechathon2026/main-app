"use client";

// Activity feed with "Why?" (PRD §18.1 #2, architecture §15.3). Items and the decision trace come
// from structured fields; no model text.

import { useState } from "react";
import type { FeedItem, FeedResponse, WhyResponse } from "@/src/server/feed";
import { Badge, Card, Empty, ErrorNote, SectionTitle, Skeleton, TxLink } from "../../_components/ui";
import { dateTime, money, shortHash } from "../../_lib/format";
import { useApi } from "../../_lib/use-api";

const TIER: Record<FeedItem["tier"], { icon: string; label: string; tone: "ok" | "lime" | "warn" | "danger" | "neutral" }> = {
  auto: { icon: "🟢", label: "Done automatically", tone: "ok" },
  approved: { icon: "🔵", label: "Done with your approval", tone: "lime" },
  waiting: { icon: "🟡", label: "Waiting for you", tone: "warn" },
  denied: { icon: "🔴", label: "Blocked", tone: "danger" },
  failed: { icon: "⚪", label: "Did not complete", tone: "neutral" },
  info: { icon: "⚪", label: "Closed", tone: "neutral" },
};

export default function ActivityPage() {
  const { data, error } = useApi<FeedResponse>("/api/feed", { pollMs: 15_000 });
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="text-sm text-grey-500">Everything Reins did or tried, with the rule that decided it.</p>
      </header>
      {error ? (
        <ErrorNote error={error} />
      ) : !data ? (
        <Card>
          <Skeleton lines={6} />
        </Card>
      ) : data.items.length === 0 ? (
        <Empty>No activity yet. Ask Reins to pay a bill in Chat.</Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
          <ul className="space-y-2">
            {data.items.map((it) => (
              <FeedRow key={it.id} item={it} active={open === it.id} onWhy={() => setOpen(open === it.id ? null : it.id)} />
            ))}
          </ul>
          <div className="md:sticky md:top-6 md:self-start">{open ? <WhyPanel id={open} onClose={() => setOpen(null)} /> : <p className="hidden text-sm text-grey-500 md:block">Pick an item and tap “Why?” to see every rule that was checked.</p>}</div>
        </div>
      )}
    </div>
  );
}

function FeedRow({ item, active, onWhy }: { item: FeedItem; active: boolean; onWhy: () => void }) {
  const t = TIER[item.tier];
  return (
    <li>
      <Card className={active ? "ring-2 ring-ink" : ""}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Badge tone={t.tone}>
              <span aria-hidden>{t.icon}</span> {t.label}
            </Badge>
            <h3 className="mt-1.5 text-sm font-semibold">{item.title}</h3>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-grey-500">
              {dateTime(item.executedAt ?? item.createdAt)} · mandate v{item.mandateVersion}
              {item.actor === "user" ? <Badge>you</Badge> : null}
              {item.tx ? <TxLink tx={item.tx} /> : null}
            </div>
          </div>
          {item.amount ? <div className="text-sm font-semibold">{money(item.amount)}</div> : null}
        </div>
        {item.reason ? (
          <p className={`mt-2 rounded-lg px-3 py-2 text-xs ${item.tier === "denied" ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn"}`}>
            {item.reason.why}
            {item.reason.fix ? <span className="block text-ink-soft">To allow it: {item.reason.fix}</span> : null}
          </p>
        ) : null}
        <button onClick={onWhy} className="mt-2 min-h-9 text-xs font-semibold text-lavender-strong hover:underline">
          {active ? "Hide why" : "Why?"}
        </button>
      </Card>
    </li>
  );
}

function WhyPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error } = useApi<WhyResponse>(`/api/feed/${id}/why`);
  return (
    <Card>
      <SectionTitle
        action={
          <button onClick={onClose} className="min-h-9 px-2 text-xs text-grey-500" aria-label="Close">
            ✕
          </button>
        }
      >
        Why this happened
      </SectionTitle>
      {error ? (
        <ErrorNote error={error} />
      ) : !data ? (
        <Skeleton lines={6} />
      ) : (
        <div className="space-y-4 text-sm">
          <p>
            Decision <Badge tone={data.decision === "allow" ? "ok" : data.decision === "deny" ? "danger" : "warn"}>{data.decision ?? "none"}</Badge> under mandate v
            {data.mandate.version}
            {data.mandate.hash ? <span className="font-mono text-xs text-grey-500"> ({shortHash(data.mandate.hash)})</span> : null}
          </p>
          <ol className="space-y-1">
            {data.trace.map((t, i) => (
              <li key={`${t.ruleId}-${i}`} className="flex items-start gap-2">
                <span aria-hidden>{t.result === "allow" ? "✓" : t.result === "deny" ? "✕" : "?"}</span>
                <span>
                  <span className="font-mono text-xs">§{t.ruleId}</span> <span className="text-grey-500">{t.text}</span>
                  {t.fix ? <span className="block text-xs text-ink-soft">To allow it: {t.fix}</span> : null}
                </span>
              </li>
            ))}
            {data.trace.length === 0 ? <li className="text-grey-500">No Gate decision recorded yet.</li> : null}
          </ol>
          <div>
            <div className="mb-1 text-xs font-medium text-grey-500">Audit log (hash-chained)</div>
            <ul className="space-y-1 font-mono text-[11px] text-ink-soft">
              {data.audit.map((a) => (
                <li key={a.seq} title={a.hash}>
                  #{a.seq} {a.actor}/{a.eventType} {shortHash(a.hash)} ← {shortHash(a.prevHash)}
                </li>
              ))}
            </ul>
          </div>
          <p className="font-mono text-[11px] text-grey-500">
            action {shortHash(data.argsHash)} · key {data.idempotencyKey}
          </p>
        </div>
      )}
    </Card>
  );
}
