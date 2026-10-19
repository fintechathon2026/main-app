"use client";

// Approvals inbox (architecture §15.2). Polls /api/approvals; a decision resumes the plan server
// side and the result's feed lines are shown as plain text.

import { useState } from "react";
import type { ApprovalsResponse, DecisionResponse } from "@/app/api/approvals/_lib/cards";
import { ApprovalCardView } from "../../_components/approval-card";
import { Card, Empty, ErrorNote, Skeleton } from "../../_components/ui";
import { useApi } from "../../_lib/use-api";

export default function ApprovalsPage() {
  const { data, error, reload } = useApi<ApprovalsResponse>("/api/approvals?status=pending", { pollMs: 10_000 });
  const [results, setResults] = useState<{ id: string; text: string }[]>([]);

  function onDecided(r: DecisionResponse) {
    const lines = r.resume?.feed.length ? r.resume.feed : [r.status === "approved" ? "Approved. The action will run under your mandate." : "Rejected. Nothing was done."];
    setResults((prev) => [...lines.map((text, i) => ({ id: `${r.approvalId}-${i}`, text })), ...prev]);
    reload();
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
        <p className="text-sm text-grey-500">Each approval covers one exact action, once, before it expires.</p>
      </header>

      {results.length ? (
        <Card className="bg-ok-soft ring-0">
          <ul className="space-y-1 text-sm text-ok">
            {results.map((r) => (
              <li key={r.id}>{r.text}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      {error ? (
        <ErrorNote error={error} />
      ) : !data ? (
        <Card>
          <Skeleton lines={5} />
        </Card>
      ) : data.items.length === 0 ? (
        <Empty>Nothing waiting. Reins will ask here when an action is outside your auto-approve rules.</Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.items.map((c) => (
            <ApprovalCardView key={c.id} card={c} onDecided={onDecided} />
          ))}
        </div>
      )}
    </div>
  );
}
