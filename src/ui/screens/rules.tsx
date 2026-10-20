"use client";

// Your rules (docs/ui-direction.md §8): the signed mandate as plain sentences, its version
// history, and a way to ask for a change. Every sentence is generated from the policy fields,
// never from AI text. Data: GET /api/mandates/active (the signed policy) and /history. Changes go
// through POST /api/mandates/compile (read-back plus the diff against the active rules), then
// POST /api/mandates/activate when the user signs. A change that gives more permission (widening
// or mixed) uses the Blocked colour and keeps Sign disabled for a 10-second review (PRD FR6.7,
// docs/ui-direction.md §8); the server refuses it without that review. G6: only this screen
// activates; the agent never does.

import { PencilSimple } from "@phosphor-icons/react/dist/ssr";
import { useEffect, useState } from "react";
import activeFixture from "@/fixtures/api/mandates-active.json";
import historyFixture from "@/fixtures/api/mandates-history.json";
import type { Policy } from "@/src/core/mandate/schema";
import type {
  MandateActivateResponse,
  MandateActiveResponse,
  MandateChangeRelation,
  MandateCompileResponse,
  MandateFieldChange,
  MandateHistoryResponse,
  MandateVersion,
} from "@/src/server/api-types";
import { SignOutButton } from "../auth/sign-out";
import { postJson, useApi } from "../data";
import { dateTime, formatMoney } from "../format";
import { BottomSheet } from "../components/overlay";
import { PageHeader } from "../components/page";
import { Button, StatusBadge } from "../components/primitives";
import { SourceInfo } from "../components/source";
import { ErrorState, SkeletonList } from "../components/states";
import type { Status } from "../words";

type Mandate = Policy;
type Rule = { text: string; does: Status; id: string };

// Registry ids -> names (from the biller registry in Lin's seed).
const PAYEE_NAMES: Record<string, string> = {
  SZ_POWER: "State Grid Shenzhen",
  CHINA_MOBILE: "China Mobile",
  LANDLORD_WANG: "Landlord Wang",
};

function rulesOf(m: Mandate): { title: string; rules: Rule[] }[] {
  const cny = (n: number) => formatMoney({ amount: n, currency: m.base_currency }, { decimals: false });
  const kinds = m.prepaid.auto_exit_on.map((k) => (k === "court_enforcement" ? "a court order" : "a closing notice")).join(" or ");
  const trials = m.subscriptions.auto_cancel_trials;
  return [
    {
      title: "Who can get paid",
      rules: [
        { id: "payees.allow", does: "done", text: m.payees.allow.length ? `Money only goes to: ${m.payees.allow.map((p) => PAYEE_NAMES[p] ?? p).join(", ")}.` : "No payees are saved yet, so no money can go out." },
        { id: "payees.new_payee", does: m.payees.new_payee === "deny" ? "blocked" : "ask", text: m.payees.new_payee === "deny" ? "Reins never adds a new payee. Only you can, in your saved payees." : "New payees need your OK." },
      ],
    },
    {
      title: "Bills",
      rules: [
        m.bills.auto_pay_max > 0
          ? { id: "bills.auto_pay_max", does: "done" as const, text: `Bills up to ${cny(m.bills.auto_pay_max)} are paid for you, ${m.bills.pay_days_before_due} days before they are due.` }
          : { id: "bills.auto_pay_max", does: "ask" as const, text: "No bill is paid without your OK." },
        { id: "bills.over_auto_pay_max", does: "ask", text: `Bills over ${cny(m.bills.auto_pay_max)} wait for your OK.` },
        { id: "bills.anomaly", does: "ask", text: "A bill that looks unusual compared with your last ones waits for your OK." },
      ],
    },
    {
      title: "Subscriptions",
      rules: [
        { id: "subscriptions.cancel", does: m.subscriptions.cancel === "confirm" ? "ask" : "blocked", text: m.subscriptions.cancel === "confirm" ? "Cancelling a subscription needs your OK." : "Reins never cancels a subscription." },
        { id: "subscriptions.subscribe", does: m.subscriptions.subscribe === "deny" ? "blocked" : "ask", text: m.subscriptions.subscribe === "deny" ? "Reins never starts a new subscription." : "Starting a subscription needs your OK." },
        { id: "subscriptions.renewal_notice_days", does: "done", text: `You get a reminder ${m.subscriptions.renewal_notice_days} days before each renewal.` },
        { id: "subscriptions.renew_unseen_price_increase", does: "ask", text: "A price rise you have not seen needs your OK before it renews." },
        ...(trials.enabled
          ? [{ id: "subscriptions.auto_cancel_trials", does: "done" as const, text: `Free trials are cancelled ${trials.days_before_charge} day before the first charge, with a reminder ${trials.notify_days_before} days before. You can keep any trial.` }]
          : []),
      ],
    },
    {
      title: "Prepaid packages",
      rules: [
        { id: "prepaid.purchase", does: m.prepaid.purchase === "deny" ? "blocked" : "ask", text: m.prepaid.purchase === "deny" ? "Packages cannot be bought through Reins." : "Only you can buy a package, and it needs your OK." },
        ...(m.prepaid.escrow_only
          ? [{ id: "prepaid.escrow_only", does: "blocked" as const, text: "Paying ahead is only allowed when the money is held safely until you use it." }]
          : []),
        { id: "prepaid.max_prepay", does: "ask", text: `Up to ${cny(m.prepaid.max_prepay)} can be paid ahead in total.` },
        m.prepaid.auto_exit_on.length
          ? { id: "prepaid.auto_exit_on", does: "done" as const, text: `If there is ${kinds} about the business, Reins takes your unused money back for you. The notice must be less than ${m.prepaid.attestation_max_age_days} days old, and the money can only go back to you.` }
          : { id: "prepaid.auto_exit_on", does: "ask" as const, text: "Reins never leaves a package on its own. You decide." },
        ...(m.prepaid.warn_on_soft_signals
          ? [{ id: "prepaid.warn_on_soft_signals", does: "suggest" as const, text: "Early warning signs, like more complaints, are shown to you. Reins does not act on them." }]
          : []),
      ],
    },
    {
      title: "Limits",
      rules: [
        { id: "global.daily_outflow_cap", does: "blocked", text: `At most ${cny(m.global.daily_outflow_cap)} can leave your account in one day. Anything over it is blocked.` },
        { id: "fx.margin_pct", does: "done", text: `Foreign charges are worked out with the official reference rate plus a ${m.fx.margin_pct}% card margin.` },
      ],
    },
  ];
}

export function RulesScreen() {
  const active = useApi<MandateActiveResponse>("/api/mandates/active", activeFixture as MandateActiveResponse);
  const history = useApi<MandateHistoryResponse>("/api/mandates/history", historyFixture as MandateHistoryResponse);
  const [editing, setEditing] = useState(false);

  if (active.state === "loading" || history.state === "loading") return <SkeletonList rows={6} />;
  if (active.state === "error") return <ErrorState onRetry={active.retry} />;
  if (history.state === "error") return <ErrorState onRetry={history.retry} />;

  const current = active.data;
  const m = current.policy;
  const groups = rulesOf(m);

  return (
    <>
      <PageHeader
        title="Your rules"
        sample={active.sample || history.sample}
        sub={
          <>
            Version <span className="amount">{current.version}</span>, signed by you on {dateTime(current.signedAt)}
          </>
        }
      >
        <Button variant="outline" onClick={() => setEditing(true)}>
          <PencilSimple size={18} aria-hidden />
          Change rules
        </Button>
      </PageHeader>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-8 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="min-w-0 space-y-6">
            <div className="rounded-card bg-band p-5 text-band-ink">
              <p className="flex items-center gap-1 text-[14px] text-band-muted">
                The most Reins can pay out in one day
                <SourceInfo label="Why this number">
                  This is your daily limit. However many bills are due, Reins cannot send more than this in one day, and only to
                  your saved payees.
                </SourceInfo>
              </p>
              <p className="amount mt-1 text-[32px] font-medium tracking-tight">
                {formatMoney({ amount: m.global.daily_outflow_cap, currency: m.base_currency }, { decimals: false })}
              </p>
            </div>

            {groups.map((g) => (
              <section key={g.title} aria-labelledby={`h-${g.title}`}>
                <h2 id={`h-${g.title}`} className="px-1 pb-2 text-[17px] font-semibold">
                  {g.title}
                </h2>
                <ul className="overflow-hidden rounded-card border border-line bg-surface">
                  {g.rules.map((r) => (
                    <li key={r.id} className="flex flex-col gap-2 border-b border-line px-4 py-4 last:border-b-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <div className="min-w-0">
                        <p className="text-[15px] leading-relaxed">{r.text}</p>
                        <p className="num mt-1 break-all text-[12px] text-muted">§{r.id}</p>
                      </div>
                      <span className="self-start">
                        <StatusBadge status={r.does} />
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            <div className="lg:hidden">
              <h2 className="px-1 pb-2 text-[17px] font-semibold">Change history</h2>
              <div className="rounded-card border border-line bg-surface p-4">
                <History versions={history.data} activeVersion={current.version} />
              </div>
              <div className="mt-6 flex justify-center">
                <SignOutButton />
              </div>
            </div>
          </div>
          <aside className="hidden lg:block" aria-label="Change history">
            <div className="sticky top-8 rounded-card border border-line bg-surface p-6">
              <History versions={history.data} activeVersion={current.version} />
            </div>
          </aside>
      </div>

      <ChangeSheet
        open={editing}
        current={m}
        onClose={() => setEditing(false)}
        onSigned={() => {
          setEditing(false);
          active.reload();
          history.reload();
        }}
      />
    </>
  );
}

function History({ versions, activeVersion }: { versions: MandateVersion[]; activeVersion: number }) {
  return (
    <div>
      <h2 className="hidden text-[17px] font-semibold lg:block">Change history</h2>
      <ol className="mt-2 space-y-4 lg:mt-4">
        {versions.map((v) => (
          <li key={v.version} className="relative pl-6">
            <span
              className={`absolute left-0 top-1.5 size-2.5 rounded-full ${v.version === activeVersion ? "bg-ink" : "bg-line"}`}
              aria-hidden
            />
            <p className="text-[15px] font-semibold">
              Version <span className="amount">{v.version}</span>
              {v.version === activeVersion && <span className="ml-2 text-[13px] font-normal text-muted">current</span>}
            </p>
            <p className="text-[14px]">{v.change}</p>
            <p className="text-[13px] text-muted">
              {v.direction === "less" ? "Less permission. " : v.direction === "more" ? "More permission. " : ""}
              {dateTime(v.signedAt)}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Seconds a change that gives more permission must be on screen before Sign is enabled (PRD FR6.7). */
const REVIEW_SECONDS = 10;
/** Widening and mixed changes need the review; the server enforces the same rule. */
const needsReview = (r: MandateChangeRelation) => r === "widening" || r === "incomparable";

const FIELD_NAMES: Record<string, string> = {
  "payees.allow": "Saved payees",
  "payees.new_payee": "New payees",
  "bills.auto_pay_max": "Auto-pay limit",
  "bills.pay_days_before_due": "Days before due to pay",
  "bills.anomaly.method": "Unusual-bill check",
  "bills.anomaly.k": "Unusual-bill tolerance",
  "bills.anomaly.alpha": "Unusual-bill rate",
  "bills.anomaly.min_history": "Bills needed before auto-pay",
  "subscriptions.cancel": "Cancelling subscriptions",
  "subscriptions.subscribe": "Starting subscriptions",
  "subscriptions.renewal_notice_days": "Renewal reminder days",
  "subscriptions.renew_unseen_price_increase": "Renewing after a price rise",
  "subscriptions.auto_cancel_trials.enabled": "Cancelling free trials",
  "subscriptions.auto_cancel_trials.days_before_charge": "Trial cancel days",
  "subscriptions.auto_cancel_trials.notify_days_before": "Trial reminder days",
  "prepaid.purchase": "Buying packages",
  "prepaid.escrow_only": "Money held safely",
  "prepaid.max_prepay": "Prepaid limit",
  "prepaid.auto_exit_on": "Notices that end a package",
  "prepaid.attestation_max_age_days": "Notice age limit (days)",
  "prepaid.warn_on_soft_signals": "Early warnings",
  "global.daily_outflow_cap": "Daily limit",
  "global.expires_at": "Rules end",
  "fx.margin_pct": "Foreign card margin",
  savings_sweep: "Moving money to savings",
  budgets: "Budgets",
};
const MONEY_PATHS = /^(bills\.auto_pay_max|global\.daily_outflow_cap|prepaid\.max_prepay|global\.per_payee_daily_cap\..+)$/;

const fieldName = (path: string) =>
  FIELD_NAMES[path] ??
  (path.startsWith("global.per_payee_daily_cap.")
    ? `Daily limit for ${PAYEE_NAMES[path.slice(27)] ?? path.slice(27)}`
    : path.replaceAll("_", " ").replaceAll(".", ": "));

function valueAt(obj: unknown, path: string): unknown {
  let v: unknown = obj;
  for (const k of path.split(".")) v = v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined;
  return v;
}

function showValue(path: string, v: unknown, currency: string): string {
  if (v === undefined || v === null) return "none";
  if (typeof v === "number" && MONEY_PATHS.test(path)) return formatMoney({ amount: v, currency }, { decimals: false });
  if (typeof v === "number" && path === "fx.margin_pct") return `${v}%`;
  if (typeof v === "boolean") return v ? "on" : "off";
  if (Array.isArray(v)) return v.length ? v.map((x) => PAYEE_NAMES[String(x)] ?? String(x)).join(", ") : "none";
  if (typeof v === "object") return "set";
  return String(v);
}

/** The field-by-field diff against the active rules, with the permission each change gives. */
function ChangeList({ changes, current, next }: { changes: MandateFieldChange[]; current: Policy; next: unknown }) {
  if (changes.length === 0) return <p className="mt-2 text-[14px]">Nothing changes in what Reins may do.</p>;
  return (
    <ul className="mt-2 divide-y divide-line text-[14px]">
      {changes.map((c) => (
        <li key={c.path} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
          <span className="min-w-0">
            <span className="font-semibold">{fieldName(c.path)}</span>{" "}
            <span className="amount">
              {showValue(c.path, valueAt(current, c.path), current.base_currency)} → {showValue(c.path, valueAt(next, c.path), current.base_currency)}
            </span>
          </span>
          <span className={`shrink-0 text-[13px] font-semibold ${c.direction === "narrower" ? "text-ok" : "text-stop"}`}>
            {c.direction === "narrower" ? "Less permission" : "More permission"}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ChangeSheet({ open, current, onClose, onSigned }: { open: boolean; current: Policy; onClose: () => void; onSigned: () => void }) {
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "failed" | "signing" | "sign_failed">("idle");
  const [draft, setDraft] = useState<MandateCompileResponse | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const review = draft !== null && needsReview(draft.relation);

  // The review countdown runs while a widening draft is on screen; a new draft restarts it.
  useEffect(() => {
    if (!review) return;
    const t = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [review, draft]);

  async function check() {
    setState("busy");
    setDraft(null);
    const r = await postJson<MandateCompileResponse>("/api/mandates/compile", { text });
    if (r.ok) {
      setDraft(r.data);
      setSecondsLeft(needsReview(r.data.relation) ? REVIEW_SECONDS : 0);
      setState("idle");
    } else {
      setState("failed");
    }
  }

  async function sign() {
    if (!draft) return;
    setState("signing");
    const r = await postJson<MandateActivateResponse>("/api/mandates/activate", {
      policy: draft.policy,
      createdVia: "nl",
      ...(review ? { confirmWidening: true } : {}),
    });
    if (r.ok) {
      setText("");
      setDraft(null);
      setState("idle");
      onSigned();
    } else {
      setState("sign_failed");
    }
  }

  function close() {
    setDraft(null);
    setState("idle");
    onClose();
  }

  const busy = state === "busy" || state === "signing";

  return (
    <BottomSheet open={open} onClose={close} label="Change your rules" className="lg:[&>[role=dialog]]:inset-x-auto lg:[&>[role=dialog]]:left-1/2 lg:[&>[role=dialog]]:bottom-auto lg:[&>[role=dialog]]:top-1/2 lg:[&>[role=dialog]]:w-[520px] lg:[&>[role=dialog]]:-translate-x-1/2 lg:[&>[role=dialog]]:-translate-y-1/2 lg:[&>[role=dialog]]:rounded-card">
      <h2 className="text-[20px] font-semibold">Change your rules</h2>
      <p className="mt-1 text-[15px] text-muted">
        Write the change in your own words. Reins reads it back to you as rules before you sign. Nothing changes until you sign.
      </p>
      <label htmlFor="rule-change" className="mt-5 block text-[14px] font-semibold">
        What should change?
      </label>
      <textarea
        id="rule-change"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setDraft(null);
          if (state === "sign_failed") setState("idle");
        }}
        disabled={state === "signing"}
        rows={4}
        maxLength={4000}
        placeholder="For example: pay bills under ¥200 without asking"
        className="mt-2 w-full rounded-field border border-line bg-page p-3 text-[16px] placeholder:text-muted focus:border-ink lg:text-[15px] focus:outline-none"
      />
      {state === "failed" && (
        <p role="alert" className="mt-4 rounded-field bg-stop-bg px-3 py-2 text-[14px] text-stop">
          Reins could not read this change. Your rules did not change.
        </p>
      )}
      {state === "sign_failed" && (
        <p role="alert" className="mt-4 rounded-field bg-stop-bg px-3 py-2 text-[14px] text-stop">
          Signing did not go through. Your rules did not change.
        </p>
      )}

      {draft && (
        <section aria-labelledby="readback-h" className="mt-5 rounded-field border border-line bg-page p-4">
          <h3 id="readback-h" className="text-[15px] font-semibold">
            Read back: the full rules this would sign
          </h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[14px] leading-relaxed">
            {draft.readback.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {draft.defaulted.length > 0 && (
            <p className="mt-3 text-[13px] text-muted">
              You did not mention <span className="amount">{draft.defaulted.length}</span> settings, so they take their safest value
              (never, or ask you first).
            </p>
          )}
        </section>
      )}

      {draft && (
        <section
          aria-labelledby="changes-h"
          className={`mt-4 rounded-field border p-4 ${review ? "border-2 border-stop" : "border-line bg-page"}`}
        >
          <h3 id="changes-h" className="text-[15px] font-semibold">
            {review ? "This gives Reins more permission" : "What changes"}
          </h3>
          {review ? (
            <p className="mt-1 text-[14px] text-stop">
              Take a moment to read what gets bigger. You can sign after a {REVIEW_SECONDS}-second review.
            </p>
          ) : (
            <p className="mt-1 text-[14px] text-muted">
              {draft.relation === "first" ? "These are your first rules." : "Reins gets less or the same permission. This applies as soon as you sign."}
            </p>
          )}
          <ChangeList changes={draft.changes} current={current} next={draft.policy} />
        </section>
      )}

      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="quiet" onClick={close} disabled={state === "signing"}>
          {draft ? "Close" : "Cancel"}
        </Button>
        <Button variant={draft ? "outline" : "primary"} onClick={check} disabled={text.trim().length < 3 || busy}>
          {state === "busy" ? "Reading…" : draft ? "Read it again" : "Read it back to me"}
        </Button>
        {draft && (
          <Button onClick={sign} disabled={busy || secondsLeft > 0}>
            {state === "signing" ? "Signing…" : secondsLeft > 0 ? `Sign in ${secondsLeft} s` : "Sign these rules"}
          </Button>
        )}
      </div>
    </BottomSheet>
  );
}
