"use client";

// Activity (docs/ui-direction.md §8): everything Reins did or tried, and why.
// Data: GET /api/feed (R2, not built yet) -> labelled sample until it lands.

import { ArrowRight, Check, X } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { useState } from "react";
import { useApi, useNow } from "../data";
import { dateTime, dayLabel } from "../format";
import { MasterDetail, useIsDesktop } from "../components/master-detail";
import { PageHeader } from "../components/page";
import { AgentNote, ChainLink, Money, Row, Rows, SimulatedTag, StatusBadge, StatusIcon } from "../components/primitives";
import { ErrorState, SkeletonList } from "../components/states";
import { SAMPLE_FEED, type FeedItem } from "../sample";
import { STATUS_LABEL } from "../words";

export function ActivityScreen() {
  const feed = useApi<FeedItem[]>("/api/feed", SAMPLE_FEED);
  const now = useNow();
  const isDesktop = useIsDesktop();
  const [picked, setPicked] = useState<string | null | undefined>(undefined);

  if (feed.state === "loading" || !now) return <SkeletonList rows={6} />;
  if (feed.state === "error") return <ErrorState onRetry={feed.retry} />;

  const items = feed.data;
  const selectedId = picked !== undefined ? picked : isDesktop ? (items[0]?.id ?? null) : null;
  const selected = items.find((i) => i.id === selectedId) ?? null;

  const groups = new Map<string, FeedItem[]>();
  for (const i of items) {
    const k = dayLabel(i.at, now);
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }

  return (
    <>
      <PageHeader title="Activity" sample={feed.sample} sub="Everything Reins did or tried, and why." />
      <MasterDetail
        detailKey={selectedId ?? "none"}
        detailLabel="Why this happened"
        onClose={() => setPicked(null)}
        detail={selected ? <WhyDetail item={selected} /> : null}
        list={
          <div>
            <div className="overflow-hidden rounded-card border border-line bg-surface">
              {[...groups.entries()].map(([label, rows]) => (
                <div key={label} className="border-b border-line last:border-b-0">
                  <h2 className="px-4 pt-3 text-[13px] font-semibold text-muted">{label}</h2>
                  <ul>
                    {rows.map((i) => (
                      <li key={i.id} className="border-b border-line last:border-b-0">
                        <button
                          onClick={() => setPicked(i.id)}
                          aria-pressed={i.id === selectedId}
                          className={`flex min-h-16 w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-sunken ${
                            i.id === selectedId ? "lg:bg-sunken" : ""
                          }`}
                        >
                          <StatusIcon status={i.status} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[15px] font-semibold">{i.title}</span>
                            <span className="line-clamp-2 text-[13px] text-muted">{i.detail}</span>
                            <span className="mt-1 block text-[12px] font-semibold text-muted">{STATUS_LABEL[i.status]}</span>
                          </span>
                          {i.amount && <Money value={i.amount} className="pt-0.5" />}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <Link
              href="/evidence"
              className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-full px-1 text-[15px] font-semibold hover:underline"
            >
              See full record
              <ArrowRight size={16} aria-hidden />
            </Link>
          </div>
        }
      />
    </>
  );
}

function WhyDetail({ item }: { item: FeedItem }) {
  return (
    <div>
      <StatusBadge status={item.status} />
      <h2 className="mt-3 text-[20px] font-semibold leading-tight">{item.title}</h2>
      {item.amount && <Money value={item.amount} size="lg" className="mt-3 block" />}
      <p className="mt-3 text-[15px] leading-relaxed">{item.detail}</p>

      <h3 className="mt-6 text-[15px] font-semibold">Rule check</h3>
      <ul className="mt-2 space-y-2">
        {item.checks.map((c) => (
          <li key={c.label} className="flex items-start gap-2 text-[14px]">
            <span
              className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ${c.passed ? "bg-ok-bg text-ok" : "bg-stop-bg text-stop"}`}
              aria-label={c.passed ? "Passed" : "Did not pass"}
            >
              {c.passed ? <Check size={12} weight="bold" aria-hidden /> : <X size={12} weight="bold" aria-hidden />}
            </span>
            {c.label}
          </li>
        ))}
      </ul>

      <div className="mt-6">
        <Rows>
          <Row label="When">{dateTime(item.at)}</Row>
          <Row label="Rule">
            <span className="num break-all text-[13px]">
              {item.ruleIds.map((id) => `§${id}`).join(", ")} v{item.mandateVersion}
            </span>
          </Row>
          <Row label="Data from">
            <ul className="space-y-1">
              {item.origins.map((o) => (
                <li key={o.label} className="flex flex-wrap items-center gap-2">
                  {o.label}
                  {o.simulated && <SimulatedTag />}
                </li>
              ))}
            </ul>
          </Row>
          {item.tx && (
            <Row label="On chain">
              <ChainLink hash={item.tx.hash} url={item.tx.explorerUrl} />
            </Row>
          )}
        </Rows>
      </div>

      {item.status === "blocked" && (
        <p className="mt-4 rounded-field bg-sunken px-3 py-2 text-[14px]">
          Nothing was paid. To allow a payment like this, add the payee in Your rules first.
        </p>
      )}
      {item.agentNote && (
        <div className="mt-4">
          <AgentNote>{item.agentNote}</AgentNote>
        </div>
      )}
    </div>
  );
}
