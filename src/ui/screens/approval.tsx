"use client";

// Approval card (docs/ui-direction.md §9). Every field comes from the card the server built
// from the action row (app/api/approvals/_lib/cards.ts), never from AI text. One OK authorizes
// exactly this action, once, before it expires (G3), and the card says so in plain words.

import { CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { useState } from "react";
import type { ApprovalCard, DecisionResponse } from "@/app/api/approvals/_lib/cards";
import { postJson } from "../data";
import { dayMonth, expiresIn, formatMoney, shortHash } from "../format";
import { Button, Money, Row, Rows, StatusBadge } from "../components/primitives";
import { SourceInfo } from "../components/source";
import { ruleText } from "../words";

type Outcome = { kind: "approved" | "rejected" } | { kind: "error"; text: string } | null;

const ERRORS: Record<number, string> = {
  410: "This request expired. Nothing was paid. Ask Reins to check again.",
  409: "This request was already answered.",
};

export function approvalSubtitle(card: ApprovalCard): string {
  if (card.subject?.kind === "bill" && card.subject.dueDate) return `Bill due ${dayMonth(card.subject.dueDate)}`;
  if (card.subject?.kind === "subscription" && card.subject.nextRenewal) return `Renews ${dayMonth(card.subject.nextRenewal)}`;
  if (card.subject?.kind === "prepaid_plan") return card.payee?.name ?? "Prepaid package";
  return card.payee?.name ?? "";
}

export function approvalHeadline(card: ApprovalCard): string {
  if (card.tool === "pay_bill" && card.payee) return `Pay ${card.payee.name}`;
  if (card.tool === "cancel_subscription" && card.title.includes(": ")) return `Cancel ${card.title.split(": ")[1]}`;
  return card.title;
}

export function ApprovalDetail({ card, now }: { card: ApprovalCard; now: Date }) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const isCancel = card.tool === "cancel_subscription";

  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    const r = await postJson<DecisionResponse>(`/api/approvals/${card.id}`, { decision });
    setBusy(false);
    if (r.ok) return setOutcome({ kind: r.data.status === "approved" ? "approved" : "rejected" });
    const nothing = card.tool === "pay_bill" ? "Nothing was paid." : "Nothing changed.";
    setOutcome({ kind: "error", text: ERRORS[r.status] ?? `That did not go through. ${nothing} Try again.` });
  }

  if (outcome?.kind === "approved" || outcome?.kind === "rejected") {
    return (
      <div className="py-6 text-center" role="status">
        <CheckCircle size={40} weight="fill" className="mx-auto text-ok" aria-hidden />
        <p className="mt-3 text-[20px] font-semibold">{outcome.kind === "approved" ? "Approved" : "Declined"}</p>
        <p className="mt-1 text-[15px] text-muted">
          {outcome.kind === "approved"
            ? "Reins checks your rules once more, then does exactly this."
            : "Nothing will happen. You can ask Reins again any time."}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[20px] font-semibold leading-tight">{approvalHeadline(card)}</h2>
        <StatusBadge status="ask" />
      </div>

      {card.amount && (
        <div className="mt-4">
          {isCancel && <p className="text-[14px] text-muted">Saves</p>}
          <Money value={card.amount} size="lg" />
          {isCancel && <span className="ml-1 text-[15px] text-muted">a month</span>}
        </div>
      )}

      <div className="mt-4">
        <Rows>
          {card.payee && (
            <Row label="To">
              {card.payee.name} <span className="text-muted">(saved payee)</span>
            </Row>
          )}
          {card.subject?.kind === "bill" && card.subject.dueDate && <Row label="Due">{dayMonth(card.subject.dueDate)}</Row>}
          {card.subject?.kind === "subscription" && card.subject.nextRenewal && (
            <Row label="Renews">{dayMonth(card.subject.nextRenewal)}</Row>
          )}
          {card.subject?.kind === "prepaid_plan" && card.subject.unitsLeft !== null && (
            <Row label="Sessions left">
              <span className="num">
                {card.subject.unitsLeft} of {card.subject.unitsTotal}
              </span>
            </Row>
          )}
          {card.subject?.kind === "prepaid_plan" && card.subject.escrowBalance && (
            <Row label="Comes back">{formatMoney(card.subject.escrowBalance)} to your wallet</Row>
          )}
          {card.ruleIds.length > 0 && <Row label="Why we ask">{ruleText(card.ruleIds[card.ruleIds.length - 1])}</Row>}
          <Row label="Rule">
            <span className="num text-[13px]">
              {card.ruleIds.map((id) => `§${id}`).join(", ")} v{card.mandateVersion}
            </span>
          </Row>
          <Row label="Expires">{expiresIn(card.expiresAt, now)}</Row>
          <Row label="Exact action">
            <span className="num text-[13px]">{shortHash(card.actionHash)}</span>{" "}
            <SourceInfo label="What your OK covers">
              Your OK covers this exact action, once. If anything changes, such as the amount or the payee, Reins has to ask
              again.
            </SourceInfo>
          </Row>
        </Rows>
      </div>

      {outcome?.kind === "error" && (
        <p role="alert" className="mt-4 rounded-field bg-stop-bg px-3 py-2 text-[14px] text-stop">
          {outcome.text}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-2">
        <Button full onClick={() => decide("approve")} disabled={busy}>
          {isCancel ? "Cancel it" : card.amount ? `Approve ${formatMoney(card.amount)}` : "Approve"}
        </Button>
        <Button full variant="quiet" onClick={() => decide("reject")} disabled={busy}>
          {isCancel ? "Keep it" : "Decline"}
        </Button>
      </div>
    </div>
  );
}
