"use client";

// Evidence screen (architecture §15.2, §17; R4-08, R3-14): audit chain status, every transaction
// hash with its explorer link, sandbox log exports and the kill switch. Desktop-first, works on
// mobile. Everything comes from existing routes; nothing here is model text.

import { useState } from "react";
import type { PrepaidPlansResponse } from "@/src/server/api-types";
import type { AuditVerifyResult } from "@/src/server/audit";
import type { FeedResponse } from "@/src/server/feed";
import type { KillSwitchState } from "@/src/server/settings/kill-switch";
import { Badge, Button, Card, Empty, ErrorNote, SectionTitle, Skeleton, TxLink } from "../../_components/ui";
import { apiFetch, apiHeaders } from "../../_lib/api";
import { dateTime } from "../../_lib/format";
import { useApi } from "../../_lib/use-api";

type TxRow = { key: string; label: string; at: string | null; tx: { hash: string; explorerUrl: string; simulated: boolean } };

export default function EvidencePage() {
  const verify = useApi<AuditVerifyResult>("/api/audit/verify");
  const plans = useApi<PrepaidPlansResponse>("/api/prepaid/plans");
  const feed = useApi<FeedResponse>("/api/feed");

  const rows: TxRow[] = [];
  for (const p of plans.data?.plans ?? []) {
    rows.push({ key: `${p.id}-buy`, label: `Purchase · ${p.merchant.name} (${p.unitsTotal} sessions)`, at: null, tx: p.purchaseTx });
    for (const s of p.sessions) rows.push({ key: `${p.id}-s${s.sessionNo}`, label: `Check-in #${s.sessionNo} · ${p.merchant.name}`, at: s.redeemedAt, tx: s.tx });
  }
  for (const it of feed.data?.items ?? []) {
    if (it.tx) rows.push({ key: it.id, label: it.title, at: it.executedAt ?? it.createdAt, tx: it.tx });
  }
  const onChain = rows.filter((r) => !r.tx.simulated);
  const loadingTx = !plans.data && !plans.error;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Evidence</h1>
        <p className="text-sm text-grey-500">Proof of what Reins did: a tamper-evident log and every on-chain transaction.</p>
      </header>

      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <SectionTitle
            action={
              <Button variant="ghost" className="min-h-9 px-2 text-xs" onClick={verify.reload}>
                Re-check
              </Button>
            }
          >
            Audit chain
          </SectionTitle>
          {verify.error ? (
            <ErrorNote error={verify.error} />
          ) : !verify.data ? (
            <Skeleton lines={2} />
          ) : verify.data.ok ? (
            <div className="space-y-1">
              <Badge tone="ok">✓ Verified</Badge>
              <p className="text-sm">
                All <span className="font-semibold">{verify.data.count}</span> entries link to the one before. No entry was changed or removed.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <Badge tone="danger">✕ Broken</Badge>
              <p className="text-sm text-danger">
                The chain breaks at entry #{verify.data.firstBreakSeq} ({verify.data.reason ?? "hash mismatch"}). It is not repaired automatically.
              </p>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <ExportButton format="jsonl" />
            <ExportButton format="csv" />
          </div>
        </Card>

        <KillSwitchCard />
      </div>

      <Card>
        <SectionTitle action={<Badge tone="warn">Base Sepolia · test token, no value</Badge>}>Transactions</SectionTitle>
        {plans.error ? <ErrorNote error={plans.error} /> : null}
        {loadingTx ? (
          <Skeleton lines={4} />
        ) : rows.length === 0 ? (
          <Empty>No transactions yet.</Empty>
        ) : (
          <>
            <p className="mb-3 text-xs text-grey-500">
              {onChain.length} on-chain, {rows.length - onChain.length} simulated. On-chain hashes open on Basescan.
            </p>
            <ul className="divide-y divide-grey-100">
              {rows.map((r) => (
                <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm">{r.label}</div>
                    {r.at ? <div className="text-xs text-grey-500">{dateTime(r.at)}</div> : null}
                  </div>
                  <TxLink tx={r.tx} />
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}

function ExportButton({ format }: { format: "jsonl" | "csv" }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // A plain link would drop the demo-user header, so fetch and save the blob.
  async function download() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/audit/export?format=${format}`, { headers: apiHeaders(), cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 401 ? "sign in first" : `HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `reins-audit.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col">
      <Button variant="secondary" className="min-h-9 px-3 text-xs" onClick={download} disabled={busy}>
        {busy ? "Preparing…" : `Export ${format.toUpperCase()}`}
      </Button>
      {err ? <span className="mt-1 text-[11px] text-danger">{err}</span> : null}
    </span>
  );
}

function KillSwitchCard() {
  const ks = useApi<KillSwitchState>("/api/kill-switch");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const on = ks.data?.enabled ?? false;

  async function toggle() {
    if (!on && !window.confirm("Stop Reins from moving any money until you turn this off?")) return;
    setBusy(true);
    setErr(null);
    try {
      await apiFetch<KillSwitchState>("/api/kill-switch", { method: "POST", json: { enabled: !on } });
      ks.reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={on ? "ring-2 ring-danger" : ""}>
      <SectionTitle>Kill switch</SectionTitle>
      {ks.error ? (
        <ErrorNote error={ks.error} />
      ) : !ks.data ? (
        <Skeleton lines={2} />
      ) : (
        <>
          <p className="text-sm">
            {on ? (
              <>
                <Badge tone="danger">On</Badge> Reins cannot pay, cancel or move prepaid money. Money already in escrow stays yours.
              </>
            ) : (
              <>
                <Badge tone="ok">Off</Badge> Reins acts inside your mandate as usual.
              </>
            )}
          </p>
          <p className="mt-1 text-xs text-grey-500">Last changed {dateTime(ks.data.changedAt)}</p>
          <Button variant={on ? "secondary" : "danger"} className="mt-4" onClick={toggle} disabled={busy}>
            {busy ? "Saving…" : on ? "Turn off" : "Stop all actions"}
          </Button>
          {err ? <p className="mt-2 text-xs text-danger">{err}</p> : null}
        </>
      )}
    </Card>
  );
}
