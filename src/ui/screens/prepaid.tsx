"use client";

// Prepaid (docs/ui-direction.md §8): my packages and the money still held.
// Data: GET /api/prepaid/plans, /api/prepaid/offers, /api/prepaid/offers/:id/advice.
// Buying, check-in and leaving need browser signing (viem, R4-08/09); until that lands the
// buttons are shown disabled with the reason, never faked.

import { CheckCircle, Warning } from "@phosphor-icons/react/dist/ssr";
import { useState } from "react";
import adviceFixture from "@/fixtures/api/prepaid-offer-advice.json";
import offersFixture from "@/fixtures/api/prepaid-offers.json";
import plansFixture from "@/fixtures/api/prepaid-plans.json";
import type {
  PrepaidAdviceResponse,
  PrepaidOfferItem,
  PrepaidOffersResponse,
  PrepaidPlanItem,
  PrepaidPlansResponse,
  PrepaidSignal,
} from "@/src/server/api-types";
import { useApi, useNow } from "../data";
import { dateTime, dayMonth } from "../format";
import { MasterDetail, useIsDesktop } from "../components/master-detail";
import { PageHeader } from "../components/page";
import { AgentNote, Button, ChainLink, Money, Row, Rows, SimulatedTag, Tag } from "../components/primitives";
import { EmptyState, ErrorState, SkeletonList } from "../components/states";
import { ORIGIN_LABEL } from "../words";

type Sel = { kind: "plan"; id: string } | { kind: "offer"; id: string } | null;

const RISK: Record<PrepaidPlanItem["merchant"]["riskLevel"], { label: string; cls: string } | null> = {
  none: null,
  watch: { label: "Keep an eye on it", cls: "bg-ask-bg text-ask" },
  elevated: { label: "At risk", cls: "bg-stop-bg text-stop" },
};

export function PrepaidScreen() {
  const plans = useApi<PrepaidPlansResponse>("/api/prepaid/plans", plansFixture as PrepaidPlansResponse);
  const offers = useApi<PrepaidOffersResponse>("/api/prepaid/offers", offersFixture as PrepaidOffersResponse);
  const now = useNow();
  const isDesktop = useIsDesktop();
  const [picked, setPicked] = useState<Sel | undefined>(undefined);

  if (plans.state === "loading" || offers.state === "loading" || !now) return <SkeletonList rows={4} />;
  if (plans.state === "error") return <ErrorState onRetry={plans.retry} />;

  const planList = plans.data.plans;
  const offerList = offers.state === "ready" ? offers.data.offers : [];
  const held = planList.reduce((s, p) => s + (p.status === "active" ? p.balanceInEscrow.amount : 0), 0);
  const selected: Sel = picked !== undefined ? picked : isDesktop && planList[0] ? { kind: "plan", id: planList[0].id } : null;
  const plan = selected?.kind === "plan" ? planList.find((p) => p.id === selected.id) : undefined;
  const offer = selected?.kind === "offer" ? offerList.find((o) => o.id === selected.id) : undefined;

  return (
    <>
      <PageHeader
        title="Prepaid"
        sample={plans.sample || (offers.state === "ready" && offers.sample)}
        sub={
          <>
            <Money value={{ amount: held, currency: plans.data.baseCurrency }} decimals={false} className="font-semibold text-ink" /> held
            safely until you use it.
          </>
        }
      />
      <MasterDetail
        detailKey={selected ? `${selected.kind}-${selected.id}` : "none"}
        detailLabel={plan ? "Package details" : "Offer details"}
        onClose={() => setPicked(null)}
        detail={plan ? <PlanDetail plan={plan} /> : offer ? <OfferDetail offer={offer} /> : null}
        list={
          <div>
            {planList.length === 0 ? (
              <EmptyState title="No packages yet">When you buy a gym or class package through Reins, it shows up here.</EmptyState>
            ) : (
              <ul className="space-y-3">
                {planList.map((p) => {
                  const risk = RISK[p.merchant.riskLevel];
                  const on = selected?.kind === "plan" && selected.id === p.id;
                  return (
                    <li key={p.id}>
                      <button
                        onClick={() => setPicked({ kind: "plan", id: p.id })}
                        aria-pressed={on}
                        className={`w-full rounded-card border bg-surface p-5 text-left transition hover:border-ink ${on ? "border-ink" : "border-line"}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[17px] font-semibold">{p.merchant.name}</p>
                            <p className="text-[14px] text-muted">
                              {p.unitsTotal} sessions at <Money value={p.unitPrice} decimals={false} />
                            </p>
                          </div>
                          {risk && <span className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${risk.cls}`}>{risk.label}</span>}
                        </div>
                        <Sessions used={p.unitsRedeemed} total={p.unitsTotal} />
                        <div className="mt-4 flex flex-wrap items-end justify-between gap-2">
                          <div>
                            <p className="text-[13px] text-muted">Held safely until you use it</p>
                            <Money value={p.balanceInEscrow} size="lg" decimals={false} />
                          </div>
                          <p className="amount text-[14px] text-muted">
                            {p.unitsRedeemed} of {p.unitsTotal} used
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {offerList.length > 0 && (
              <section aria-labelledby="h-offers" className="mt-10">
                <h2 id="h-offers" className="px-1 text-[17px] font-semibold">
                  Thinking of buying?
                </h2>
                <p className="px-1 pb-3 text-[14px] text-muted">Reins compares paying ahead with paying per visit.</p>
                <ul className="overflow-hidden rounded-card border border-line bg-surface">
                  {offerList.map((o) => {
                    const on = selected?.kind === "offer" && selected.id === o.id;
                    return (
                      <li key={o.id} className="border-b border-line last:border-b-0">
                        <button
                          onClick={() => setPicked({ kind: "offer", id: o.id })}
                          aria-pressed={on}
                          className={`flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-sunken ${on ? "lg:bg-sunken" : ""}`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block text-[15px] font-semibold">{o.merchant.name}</span>
                            <span className="block text-[13px] text-muted">
                              {o.units} sessions, {o.merchant.escrowSupported ? "money held safely" : "no safe holding"}
                            </span>
                          </span>
                          <Money value={o.total} decimals={false} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </div>
        }
      />
    </>
  );
}

/** One small segment per session: used ones filled. */
function Sessions({ used, total }: { used: number; total: number }) {
  return (
    <div className="mt-4 grid grid-cols-[repeat(30,minmax(0,1fr))] gap-[3px]" role="img" aria-label={`${used} of ${total} sessions used`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`h-2.5 rounded-full ${i < used ? "bg-ink" : "bg-sunken"}`} />
      ))}
    </div>
  );
}

function Signals({ signals }: { signals: PrepaidSignal[] }) {
  if (signals.length === 0) return <p className="text-[14px] text-muted">No warning signs found.</p>;
  return (
    <ul className="space-y-3">
      {signals.map((s) => (
        <li key={s.summary} className="flex gap-2 text-[14px]">
          <Warning size={18} className={s.tier === "hard" ? "shrink-0 text-stop" : "shrink-0 text-ask"} aria-hidden />
          <span>
            {s.summary}
            <span className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-muted">
              {s.tier === "hard" ? "Official notice" : "Early sign, not official"},{" "}
              {s.source.simulated ? "" : `${ORIGIN_LABEL[s.source.origin]}, `}
              {dayMonth(s.observedAt)}
              {s.source.simulated && <SimulatedTag />}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function PlanDetail({ plan }: { plan: PrepaidPlanItem }) {
  const fee = plan.cancelFeeBps / 100;
  const used = plan.unitsRedeemed * plan.unitPrice.amount;

  if (plan.status === "exited_attested" || plan.status === "exited_voluntary") {
    return (
      <div className="py-4 text-center" role="status">
        <CheckCircle size={40} weight="fill" className="mx-auto text-ok" aria-hidden />
        <Money value={plan.balanceInEscrow} size="xl" className="mt-4 block" />
        <p className="mt-2 text-[16px]">is back in your wallet.</p>
        <div className="mt-6 text-left">
          <Rows>
            <Row label="Reason">{plan.status === "exited_attested" ? "Official notice about the gym" : "You left the package"}</Row>
            <Row label="Sessions">
              <span className="amount">
                {plan.unitsRedeemed} of {plan.unitsTotal} used
              </span>
            </Row>
          </Rows>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[14px] text-muted">Prepaid package</p>
      <h2 className="text-[20px] font-semibold">{plan.merchant.name}</h2>
      <Money value={plan.balanceInEscrow} size="lg" className="mt-3 block" decimals={false} />
      <p className="text-[14px] text-muted">held safely until you use it</p>

      <div className="mt-5">
        <Rows>
          <Row label="Sessions">
            <span className="amount">
              {plan.unitsRedeemed} of {plan.unitsTotal} used
            </span>
          </Row>
          <Row label="Per session">
            <Money value={plan.unitPrice} decimals={false} />
          </Row>
          <Row label="Paid to the gym">
            <Money value={{ amount: used, currency: plan.unitPrice.currency }} decimals={false} />{" "}
            <span className="text-muted">only for sessions used</span>
          </Row>
          <Row label="Leave early">
            Unused money back, minus a <span className="amount">{fee}%</span> fee
          </Row>
          <Row label="Bought">
            <ChainLink hash={plan.purchaseTx.hash} url={plan.purchaseTx.explorerUrl} />
          </Row>
        </Rows>
      </div>

      <h3 className="mt-6 text-[15px] font-semibold">Is the gym OK?</h3>
      <div className="mt-2">
        <Signals signals={plan.signals} />
      </div>
      <p className="mt-3 text-[13px] text-muted">
        If there is an official notice that the gym is closing, Reins takes your unused money back for you. Your rules allow this,
        and the money can only go back to you.
      </p>

      {plan.sessions.length > 0 && (
        <>
          <h3 className="mt-6 text-[15px] font-semibold">Last sessions</h3>
          <ul className="mt-2 divide-y divide-line">
            {plan.sessions
              .slice(-3)
              .reverse()
              .map((s) => (
                <li key={s.sessionNo} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[14px]">
                  <span>
                    Session <span className="amount">{s.sessionNo}</span>, {dateTime(s.redeemedAt)}
                  </span>
                  <ChainLink hash={s.tx.hash} url={s.tx.explorerUrl} />
                </li>
              ))}
          </ul>
        </>
      )}

      <div className="mt-6 flex flex-col gap-2">
        <Button full disabled>
          Check in at the gym
        </Button>
        <Button full variant="quiet" disabled>
          Leave this package
        </Button>
        <p className="text-center text-[13px] text-muted">Check-in and leaving need signing in this browser, which is not set up yet.</p>
      </div>
    </div>
  );
}

function OfferDetail({ offer }: { offer: PrepaidOfferItem }) {
  const advice = useApi<PrepaidAdviceResponse>(
    `/api/prepaid/offers/${offer.id}/advice`,
    adviceFixture.offerId === offer.id ? (adviceFixture as PrepaidAdviceResponse) : undefined,
  );
  const perVisitTotal = offer.payPerVisitPrice.amount * offer.units;

  return (
    <div>
      <p className="flex items-center gap-2 text-[14px] text-muted">
        Offer {offer.simulated && <SimulatedTag />}
      </p>
      <h2 className="text-[20px] font-semibold">{offer.merchant.name}</h2>
      <Money value={offer.total} size="lg" decimals={false} className="mt-3 block" />
      <p className="text-[14px] text-muted">
        for {offer.units} sessions, offer ends {dayMonth(offer.expiresAt)}
      </p>

      <div className="mt-5">
        <Rows>
          <Row label="Per session">
            <Money value={offer.unitPrice} decimals={false} />{" "}
            <span className="text-muted">
              vs <Money value={offer.payPerVisitPrice} decimals={false} /> per visit
            </span>
          </Row>
          <Row label="Paying per visit">
            <Money value={{ amount: perVisitTotal, currency: offer.total.currency }} decimals={false} />{" "}
            <span className="text-muted">for the same sessions</span>
          </Row>
          <Row label="Money held safely">{offer.merchant.escrowSupported ? "Yes, paid out one session at a time" : "No"}</Row>
        </Rows>
      </div>

      {advice.state === "ready" && <Advice a={advice.data} />}
      {advice.state === "error" && (
        <p className="mt-5 rounded-field bg-sunken px-3 py-2 text-[14px]">Reins has no comparison for this offer yet.</p>
      )}

      <h3 className="mt-6 text-[15px] font-semibold">Is the gym OK?</h3>
      <div className="mt-2">
        <Signals signals={offer.signals} />
      </div>

      <div className="mt-6">
        <Button full disabled>
          {offer.merchant.escrowSupported ? "Buy with money held safely" : "Buy"}
        </Button>
        <p className="mt-2 text-center text-[13px] text-muted">Only you can buy a package. Buying needs signing in this browser, which is not set up yet.</p>
      </div>
    </div>
  );
}

const VERDICT: Record<PrepaidAdviceResponse["recommendation"], { text: string; cls: string }> = {
  prepay_escrow: { text: "Paying ahead is worth it, with the money held safely.", cls: "bg-ok-bg text-ok" },
  prepay_with_risk: { text: "Paying ahead saves money, but the gym shows warning signs.", cls: "bg-ask-bg text-ask" },
  pay_per_visit: { text: "Paying per visit is the safer choice here.", cls: "bg-hint-bg text-hint" },
};

function Advice({ a }: { a: PrepaidAdviceResponse }) {
  const v = VERDICT[a.recommendation];
  return (
    <div className="mt-5 rounded-card border border-line p-4">
      <p className={`rounded-field px-3 py-2 text-[15px] font-semibold ${v.cls}`}>{v.text}</p>
      <dl className="mt-4 grid grid-cols-2 gap-4 text-[14px]">
        <div>
          <dt className="text-muted">You save</dt>
          <dd>
            <Money value={a.savings} decimals={false} size="md" />
          </dd>
        </div>
        <div>
          <dt className="text-muted">Worth it after</dt>
          <dd className="text-[17px]">
            <span className="amount">{a.breakEvenSessions}</span> sessions
          </dd>
        </div>
        <div>
          <dt className="text-muted">Could lose, paid to the gym</dt>
          <dd>
            <Money value={a.expectedLossWithoutEscrow} decimals={false} size="md" />
          </dd>
        </div>
        <div>
          <dt className="text-muted">Could lose, held safely</dt>
          <dd>
            <Money value={a.expectedLossWithEscrow} decimals={false} size="md" />
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-[12px] text-muted">
        Assumes a <span className="amount">{Math.round(a.closureRate.value * 100)}%</span> chance the gym closes this year. {a.closureRate.note}
      </p>
      {a.explanation && (
        <div className="mt-3">
          <AgentNote>{a.explanation}</AgentNote>
        </div>
      )}
      <Tag className="mt-3">Numbers worked out by Reins, not the agent</Tag>
    </div>
  );
}
