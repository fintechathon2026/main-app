"use client";

// Evidence (docs/ui-direction.md §8): prove what happened. Desktop-first table; phones get a
// simple list. Data: GET /api/audit/verify (newest page of the hash-chained audit log) and
// GET /api/audit/export for the full record.

import { DownloadSimple, SealCheck, SealWarning } from "@phosphor-icons/react/dist/ssr";
import { useApi } from "../data";
import { dateTime, shortHash } from "../format";
import { PageHeader } from "../components/page";
import { ChainLink, StatusBadge } from "../components/primitives";
import { ErrorState, SkeletonList } from "../components/states";
import auditFixture from "@/fixtures/api/audit-verify.json";
import type { AuditVerifyResponse, AuditVerifyRow } from "@/src/server/api-types";

const WHO: Record<AuditVerifyRow["actor"], string> = { agent: "Reins", user: "You", system: "Schedule" };

export function EvidenceScreen() {
  const audit = useApi<AuditVerifyResponse>("/api/audit/verify", auditFixture as AuditVerifyResponse);
  if (audit.state === "loading") return <SkeletonList rows={8} />;
  if (audit.state === "error") return <ErrorState onRetry={audit.retry} />;
  const a = audit.data;

  return (
    <>
      <PageHeader title="Evidence" sample={audit.sample} sub="Every decision Reins made, in order, with the rule behind it.">
        <div className="flex gap-2">
          <a
            href="/api/audit/export?format=csv"
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-4 text-[14px] font-semibold hover:bg-sunken"
          >
            <DownloadSimple size={18} aria-hidden />
            CSV
          </a>
          <a
            href="/api/audit/export?format=jsonl"
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-4 text-[14px] font-semibold hover:bg-sunken"
          >
            <DownloadSimple size={18} aria-hidden />
            JSONL
          </a>
        </div>
      </PageHeader>

      <div
        role="status"
        className={`mb-6 flex items-start gap-3 rounded-card p-4 ${a.chainOk ? "bg-ok-bg text-ok" : "bg-stop-bg text-stop"}`}
      >
        {a.chainOk ? <SealCheck size={24} weight="fill" aria-hidden /> : <SealWarning size={24} weight="fill" aria-hidden />}
        <div>
          <p className="text-[15px] font-semibold">Tamper check: {a.chainOk ? "passed" : "failed"}</p>
          <p className="text-[14px] text-ink">
            Each entry is linked to the one before it, so changing or deleting an entry would break the check.{" "}
            <span className="amount">{a.count}</span> entries checked {dateTime(a.checkedAt)}
            {a.firstBreakSeq !== null && (
              <>
                , first break at entry <span className="amount">{a.firstBreakSeq}</span>
              </>
            )}
            .
          </p>
        </div>
      </div>

      {a.rows.length < a.count && (
        <p className="mb-3 text-[13px] text-muted">
          Showing the newest <span className="amount">{a.rows.length}</span> of <span className="amount">{a.count}</span>. Download the record for all of them.
        </p>
      )}

      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-card border border-line bg-surface lg:block">
        <table className="w-full text-left text-[14px]">
          <thead className="border-b border-line bg-sunken text-[13px] text-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold">#</th>
              <th scope="col" className="px-4 py-3 font-semibold">Time</th>
              <th scope="col" className="px-4 py-3 font-semibold">What happened</th>
              <th scope="col" className="px-4 py-3 font-semibold">By</th>
              <th scope="col" className="px-4 py-3 font-semibold">Result</th>
              <th scope="col" className="px-4 py-3 font-semibold">Rule</th>
              <th scope="col" className="px-4 py-3 font-semibold">Entry</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {a.rows.map((r) => (
              <tr key={r.seq} className="align-top">
                <td className="amount px-4 py-3 text-muted">{r.seq}</td>
                <td className="whitespace-nowrap px-4 py-3">{dateTime(r.at)}</td>
                <td className="px-4 py-3">
                  {r.event}
                  {r.tx && (
                    <div className="mt-1">
                      <ChainLink hash={r.tx.hash} url={r.tx.explorerUrl} />
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">{WHO[r.actor]}</td>
                <td className="px-4 py-3">{r.status ? <StatusBadge status={r.status} /> : <span className="text-muted" aria-label="Not a decision">—</span>}</td>
                <td className="num break-all px-4 py-3 text-[12px] text-muted">{r.ruleIds.map((id) => `§${id}`).join(" ")}</td>
                <td className="num whitespace-nowrap px-4 py-3 text-[12px] text-muted">{shortHash(r.hash)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone list */}
      <div className="lg:hidden">
        {a.rows.length === 0 && <p className="rounded-card bg-sunken px-4 py-6 text-center text-[14px] text-muted">Nothing recorded yet.</p>}
        <ul className="overflow-hidden rounded-card border border-line bg-surface empty:hidden">
          {a.rows.map((r) => (
            <li key={r.seq} className="border-b border-line px-4 py-3 last:border-b-0">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[15px] font-semibold">{r.event}</p>
                {r.status && <StatusBadge status={r.status} compact />}
              </div>
              <p className="text-[13px] text-muted">
                {dateTime(r.at)}, by {WHO[r.actor]}
              </p>
              {r.tx && (
                <div className="mt-1">
                  <ChainLink hash={r.tx.hash} url={r.tx.explorerUrl} />
                </div>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-center text-[13px] text-muted">Open on a larger screen for the full table.</p>
      </div>
    </>
  );
}
