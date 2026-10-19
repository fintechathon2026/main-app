"use client";

// Approval card (architecture §15.3, PRD §18.2). Rendered from the structured card fields only:
// title template, registry payee, hash-bound amount, rule ids. No LLM text appears here.

import { useEffect, useState } from "react";
import type { ApprovalCard, DecisionResponse } from "@/app/api/approvals/_lib/cards";
import { apiFetch } from "../_lib/api";
import { date, dateTime, money, shortHash } from "../_lib/format";
import { Badge, Button, Card } from "./ui";

const DESTRUCTIVE = new Set(["cancel_subscription", "prepaid_exit", "prepaid_exit_voluntary"]);

export function ApprovalCardView({ card, onDecided }: { card: ApprovalCard; onDecided: (r: DecisionResponse) => void }) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const destructive = DESTRUCTIVE.has(card.tool);
  const expired = useExpired(card.expiresAt);

  async function decide(decision: "approve" | "reject") {
    setBusy(decision);
    setError(null);
    try {
      onDecided(await apiFetch<DecisionResponse>(`/api/approvals/${card.id}`, { method: "POST", json: { decision } }));
    } catch (e) {
      setError(`${(e as Error).message}. No money was moved.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className={destructive ? "ring-2 ring-danger/30" : ""}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="warn">🟡 Needs approval</Badge>
            {destructive ? <Badge tone="danger">Cannot be undone</Badge> : null}
          </div>
          <h3 className="mt-2 text-base font-semibold">{card.title}</h3>
        </div>
        {card.amount ? <div className="text-right text-xl font-semibold tracking-tight">{money(card.amount)}</div> : null}
      </div>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {card.payee ? (
          <>
            <dt className="text-grey-500">Payee</dt>
            <dd>
              {card.payee.name} <Badge>registered payee</Badge>
            </dd>
          </>
        ) : null}
        <SubjectRows card={card} />
        {card.attestation ? (
          <>
            <dt className="text-grey-500">Evidence</dt>
            <dd className="flex flex-wrap items-center gap-1.5">
              {card.attestation.kind.replaceAll("_", " ")} · {date(card.attestation.issuedAt)}
              <Badge tone={card.attestation.sigValid ? "ok" : "danger"}>{card.attestation.sigValid ? "signature valid" : "signature invalid"}</Badge>
              {card.attestation.simulated ? <Badge tone="warn">simulated</Badge> : null}
            </dd>
          </>
        ) : null}
        <dt className="text-grey-500">Why asked</dt>
        <dd className="flex flex-wrap gap-1">
          {card.ruleIds.length ? card.ruleIds.map((r) => <Badge key={r} tone="lavender">§{r}</Badge>) : <span>—</span>}
          <span className="text-xs text-grey-500">mandate v{card.mandateVersion}</span>
        </dd>
        <dt className="text-grey-500">Expires</dt>
        <dd className={expired ? "text-danger" : ""}>{expired ? "Expired" : dateTime(card.expiresAt)}</dd>
      </dl>

      <p className="mt-3 font-mono text-[11px] text-grey-500" title={card.actionHash}>
        Approves exactly action {shortHash(card.actionHash)}, once.
      </p>

      {error ? <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}

      <div className="mt-4 flex gap-2">
        <Button variant="secondary" className="flex-1" disabled={busy !== null || expired} onClick={() => decide("reject")}>
          {busy === "reject" ? "Rejecting…" : "Reject"}
        </Button>
        <Button variant={destructive ? "danger" : "primary"} className="flex-1" disabled={busy !== null || expired} onClick={() => decide("approve")}>
          {busy === "approve" ? "Approving…" : "Approve"}
        </Button>
      </div>
    </Card>
  );
}

/** Re-checks expiry every 15 s; the server still enforces it on decide. */
function useExpired(expiresAt: string): boolean {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const check = () => setExpired(new Date(expiresAt).getTime() <= Date.now());
    check();
    const id = setInterval(check, 15_000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return expired;
}

function SubjectRows({ card }: { card: ApprovalCard }) {
  const s = card.subject;
  if (!s) return null;
  if (s.kind === "bill") {
    return (
      <>
        <dt className="text-grey-500">Bill</dt>
        <dd>
          {s.period ? `${s.period} · ` : ""}due {date(s.dueDate)}
        </dd>
      </>
    );
  }
  if (s.kind === "subscription") {
    return (
      <>
        <dt className="text-grey-500">Renews</dt>
        <dd>
          {date(s.nextRenewal)} {s.status ? <Badge>{s.status}</Badge> : null}
        </dd>
      </>
    );
  }
  return (
    <>
      <dt className="text-grey-500">Plan</dt>
      <dd>
        {s.unitsLeft ?? "—"} of {s.unitsTotal ?? "—"} sessions left
      </dd>
      <dt className="text-grey-500">Refund</dt>
      <dd>
        {money(s.escrowBalance)} back to you <Badge tone="lime">held safely in escrow</Badge>
      </dd>
    </>
  );
}
