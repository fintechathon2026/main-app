"use client";

// Prepaid (PRD §18.1 #10, R4-05, R4-06): plans with sessions left and balance in escrow, merchant
// risk with signal sources, offers with the advisor card. Every number comes from the API.
// Buy, check-in and voluntary exit need browser signing (R4-07/R4-09) and their routes (R2-08),
// so they are shown as not yet available rather than faked.

import { useState } from "react";
import type { PrepaidAdviceResponse, PrepaidOfferItem, PrepaidOffersResponse, PrepaidPlanItem, PrepaidPlansResponse, PrepaidSignal } from "@/src/server/api-types";
import { Badge, Button, Card, Empty, ErrorNote, SectionTitle, Skeleton, SourceTag, Stat, TxLink } from "../../_components/ui";
import { date, money, pct } from "../../_lib/format";
import { useApi } from "../../_lib/use-api";

const RISK: Record<"none" | "watch" | "elevated", { label: string; tone: "ok" | "warn" | "danger" }> = {
  none: { label: "No warnings", tone: "ok" },
  watch: { label: "Watch", tone: "warn" },
  elevated: { label: "Elevated risk", tone: "danger" },
};

export default function PrepaidPage() {
  const plans = useApi<PrepaidPlansResponse>("/api/prepaid/plans");
  const offers = useApi<PrepaidOffersResponse>("/api/prepaid/offers");

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Prepaid</h1>
        <p className="text-sm text-grey-500">
          Your package money is held safely until you use it. If the gym closes, the rest comes back to you.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Your packages</h2>
        {plans.error ? (
          <ErrorNote error={plans.error} />
        ) : !plans.data ? (
          <Card>
            <Skeleton lines={5} />
          </Card>
        ) : plans.data.plans.length === 0 ? (
          <Empty>No prepaid packages yet.</Empty>
        ) : (
          plans.data.plans.map((p) => <PlanCard key={p.id} plan={p} />)
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Offers near you</h2>
        {offers.error ? (
          <ErrorNote error={offers.error} />
        ) : !offers.data ? (
          <Card>
            <Skeleton />
          </Card>
        ) : offers.data.offers.length === 0 ? (
          <Empty>No offers right now.</Empty>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {offers.data.offers.map((o) => (
              <OfferCard key={o.id} offer={o} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function PlanCard({ plan }: { plan: PrepaidPlanItem }) {
  const left = plan.unitsTotal - plan.unitsRedeemed;
  const risk = RISK[plan.merchant.riskLevel];
  const [showSessions, setShowSessions] = useState(false);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-base font-semibold">{plan.merchant.name}</h3>
            <Badge tone={risk.tone}>{risk.label}</Badge>
            <Badge>{plan.status.replaceAll("_", " ")}</Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-grey-500">
            <span>Plan #{plan.chainPlanId}</span>
            <TxLink tx={plan.purchaseTx} />
            <Badge tone="warn">{plan.testTokenNotice}</Badge>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-4">
        <Stat label="Sessions left" value={`${left} / ${plan.unitsTotal}`} />
        <Stat label="Held in escrow" value={money(plan.balanceInEscrow)} hint="yours until used" />
        <Stat label="Per session" value={money(plan.unitPrice)} hint={`exit fee ${pct(plan.cancelFeeBps)}`} />
      </div>

      <div className="mt-3 h-2 rounded-full bg-grey-100" aria-label={`${plan.unitsRedeemed} of ${plan.unitsTotal} sessions used`}>
        <div className="h-2 rounded-full bg-lime-strong" style={{ width: `${(plan.unitsRedeemed / plan.unitsTotal) * 100}%` }} />
      </div>

      {plan.signals.length ? (
        <div className="mt-4">
          <div className="mb-1.5 text-xs font-medium text-grey-500">Merchant signals</div>
          <SignalList signals={plan.signals} />
          <p className="mt-2 text-xs text-grey-500">
            Soft signals only warn you. Reins exits automatically only on a signed closure or court notice from the registry.
          </p>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setShowSessions((v) => !v)}>
          {showSessions ? "Hide" : "Show"} check-ins ({plan.sessions.length})
        </Button>
        <Button variant="secondary" disabled title="Needs browser signing (coming next)">
          Check in
        </Button>
        <Button variant="ghost" disabled title="Needs browser signing (coming next)">
          Exit with {pct(plan.cancelFeeBps)} fee
        </Button>
      </div>

      {showSessions ? (
        <ul className="mt-3 max-h-64 divide-y divide-grey-100 overflow-y-auto rounded-xl bg-grey-50 px-3">
          {[...plan.sessions].reverse().map((s) => (
            <li key={s.sessionNo} className="flex items-center justify-between py-2 text-xs">
              <span>
                Session {s.sessionNo} · {date(s.redeemedAt)}
              </span>
              <TxLink tx={s.tx} />
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function SignalList({ signals }: { signals: PrepaidSignal[] }) {
  return (
    <ul className="space-y-1.5">
      {signals.map((s, i) => (
        <li key={`${s.kind}-${i}`} className={`rounded-xl px-3 py-2 text-sm ${s.tier === "hard" ? "bg-danger-soft" : "bg-warn-soft"}`}>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={s.tier === "hard" ? "danger" : "warn"}>{s.tier === "hard" ? "Signed notice" : "Soft signal"}</Badge>
            <span className="text-xs text-grey-500">{date(s.observedAt)}</span>
            <SourceTag source={s.source} />
          </div>
          <p className="mt-1">{s.summary}</p>
        </li>
      ))}
    </ul>
  );
}

function OfferCard({ offer }: { offer: PrepaidOfferItem }) {
  const [open, setOpen] = useState(false);
  const risk = RISK[offer.merchant.riskLevel];
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-1.5">
        <h3 className="text-base font-semibold">{offer.merchant.name}</h3>
        <Badge tone={risk.tone}>{risk.label}</Badge>
        {offer.merchant.escrowSupported ? <Badge tone="lime">Escrow protected</Badge> : <Badge tone="danger">No escrow</Badge>}
        {offer.simulated ? <Badge tone="warn">simulated</Badge> : null}
      </div>
      <p className="mt-2 text-sm">
        {offer.units} sessions for <span className="font-semibold">{money(offer.total)}</span> ({money(offer.unitPrice)} each, vs {money(offer.payPerVisitPrice)} pay per
        visit)
      </p>
      <p className="mt-0.5 text-xs text-grey-500">
        Exit fee {pct(offer.cancelFeeBps)} · offer ends {date(offer.expiresAt)}
      </p>
      {offer.signals.length ? (
        <div className="mt-3">
          <SignalList signals={offer.signals} />
        </div>
      ) : null}
      <div className="mt-3">
        <Button variant={open ? "secondary" : "primary"} onClick={() => setOpen((v) => !v)}>
          {open ? "Hide advice" : "Should I buy this?"}
        </Button>
      </div>
      {open ? <AdvisorCard offerId={offer.id} /> : null}
    </Card>
  );
}

const RECOMMENDATION: Record<PrepaidAdviceResponse["recommendation"], { label: string; tone: "ok" | "warn" | "neutral" }> = {
  prepay_escrow: { label: "Prepay, with escrow", tone: "ok" },
  prepay_with_risk: { label: "Prepay only if you accept the risk", tone: "warn" },
  pay_per_visit: { label: "Pay per visit instead", tone: "neutral" },
};

/** Advisor card (PRD §15.11). Numbers come from advise_prepaid via the advice route. */
function AdvisorCard({ offerId }: { offerId: string }) {
  const { data, error } = useApi<PrepaidAdviceResponse>(`/api/prepaid/offers/${offerId}/advice`);
  if (error) return <div className="mt-3"><ErrorNote error={error} /></div>;
  if (!data) return <div className="mt-3"><Skeleton /></div>;
  const rec = RECOMMENDATION[data.recommendation];

  return (
    <div className="mt-3 rounded-xl bg-grey-50 p-3">
      <SectionTitle action={<Badge tone={rec.tone}>{rec.label}</Badge>}>Reins advice</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="You save" value={money(data.savings)} hint={`if you use all ${data.expectedSessions} sessions`} />
        <Stat label="Break-even" value={`${data.breakEvenSessions} sessions`} hint="before prepaying pays off" />
        <Stat label="Expected loss, no escrow" value={money(data.expectedLossWithoutEscrow)} />
        <Stat label="Expected loss, with escrow" value={money(data.expectedLossWithEscrow)} hint={data.escrowAvailable ? "escrow available" : "escrow not offered"} />
      </div>
      <p className="mt-3 text-xs text-grey-500">
        Closure risk {Math.round(data.closureRate.value * 100)}% per year ({data.closureRate.source.replaceAll("_", " ")}): {data.closureRate.note}
      </p>
      {data.explanation ? <p className="mt-2 text-xs italic text-grey-500">Agent note: {data.explanation}</p> : null}
      <div className="mt-3">
        <Button disabled title="Needs browser signing (coming next)">
          Buy with escrow
        </Button>
      </div>
    </div>
  );
}
