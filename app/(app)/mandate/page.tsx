"use client";

// Mandate Card and editor (PRD §9, architecture §9.1, §15.2; R4-04). The user edits structured
// fields, the server builds the complete policy, read-back and diff (/api/mandates/preview), and
// the user signs the exact hash they reviewed (/api/mandates/activate). The agent has no path
// here (G6). Read-back lines come from server templates, never from a model.

import { useState } from "react";
import type { ChangeClass, DiffEntry } from "@/src/server/mandate/diff";
import type { Policy, PolicyDraft } from "@/src/server/mandate/schema";
import type { ActivateResponse, MandateActiveResponse, MandateHistoryResponse } from "@/src/server/mandate/store";
import { Badge, Button, Card, Empty, ErrorNote, SectionTitle, Skeleton } from "../../_components/ui";
import { apiFetch, ApiRequestError } from "../../_lib/api";
import { dateTime, shortHash } from "../../_lib/format";
import { useApi } from "../../_lib/use-api";

type Preview = {
  candidate: Policy;
  policyHash: string;
  defaulted: string[];
  readback: string[];
  activeVersion: number | null;
  diff: DiffEntry[];
  class: ChangeClass;
};

type Form = {
  autoPayMax: number;
  dailyCap: number;
  payees: string;
  newPayee: "deny" | "confirm";
  cancel: "deny" | "confirm";
  subscribe: "deny" | "confirm";
  trialsAuto: boolean;
  trialDays: number;
  prepaidPurchase: "deny" | "confirm";
  maxPrepay: number;
  exitCourt: boolean;
  exitClosure: boolean;
  fxMargin: number;
};

function formFrom(p: Policy): Form {
  return {
    autoPayMax: p.bills.auto_pay_max,
    dailyCap: p.global.daily_outflow_cap,
    payees: p.payees.allow.join(", "),
    newPayee: p.payees.new_payee,
    cancel: p.subscriptions.cancel,
    subscribe: p.subscriptions.subscribe,
    trialsAuto: p.subscriptions.auto_cancel_trials.enabled,
    trialDays: p.subscriptions.auto_cancel_trials.days_before_charge,
    prepaidPurchase: p.prepaid.purchase,
    maxPrepay: p.prepaid.max_prepay,
    exitCourt: p.prepaid.auto_exit_on.includes("court_enforcement"),
    exitClosure: p.prepaid.auto_exit_on.includes("closure_notice"),
    fxMargin: p.fx.margin_pct,
  };
}

/** Edited fields on top of the active policy, so untouched settings carry over unchanged. */
function draftFrom(f: Form, base: Policy): PolicyDraft {
  const allow = f.payees
    .split(/[\s,]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const perPayee = Object.entries(base.global.per_payee_daily_cap ?? {}).map(([biller_id, cap]) => ({ biller_id, cap }));
  return {
    fx: { rate_source: "ecb_reference", margin_pct: f.fxMargin },
    payees: { allow, new_payee: f.newPayee },
    bills: { auto_pay_max: f.autoPayMax, anomaly: { ...base.bills.anomaly }, pay_days_before_due: base.bills.pay_days_before_due },
    subscriptions: {
      ...base.subscriptions,
      cancel: f.cancel,
      subscribe: f.subscribe,
      auto_cancel_trials: { ...base.subscriptions.auto_cancel_trials, enabled: f.trialsAuto, days_before_charge: f.trialDays },
    },
    ...(base.savings_sweep ? { savings_sweep: base.savings_sweep } : {}),
    ...(base.budgets ? { budgets: base.budgets } : {}),
    prepaid: {
      ...base.prepaid,
      purchase: f.prepaidPurchase,
      max_prepay: f.maxPrepay,
      auto_exit_on: [...(f.exitCourt ? ["court_enforcement" as const] : []), ...(f.exitClosure ? ["closure_notice" as const] : [])],
    },
    global: {
      daily_outflow_cap: f.dailyCap,
      ...(perPayee.length ? { per_payee_daily_cap: perPayee } : {}),
      ...(base.global.expires_at ? { expires_at: base.global.expires_at } : {}),
    },
  };
}

const CLASS_TONE: Record<ChangeClass, "ok" | "warn" | "neutral"> = { narrowing: "ok", widening: "warn", none: "neutral" };
const CLASS_TEXT: Record<ChangeClass, string> = {
  narrowing: "Narrowing: Reins gets less room",
  widening: "Widening: Reins gets more room",
  none: "No change",
};

const show = (v: unknown) => (v === undefined ? "—" : Array.isArray(v) ? v.join(", ") || "none" : String(v));

export default function MandatePage() {
  const active = useApi<MandateActiveResponse>("/api/mandates/active");
  const history = useApi<MandateHistoryResponse>("/api/mandates/history");
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const m = active.data?.mandate ?? null;

  function onActivated(r: ActivateResponse) {
    setEditing(false);
    setNotice(
      `Mandate v${r.mandate.version} is active (${r.diff.length} change${r.diff.length === 1 ? "" : "s"}).` +
        (r.expiredApprovals ? ` ${r.expiredApprovals} waiting approval(s) expired because they were planned under the old rules.` : ""),
    );
    active.reload();
    history.reload();
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Mandate</h1>
        <p className="text-sm text-grey-500">Your rules. Reins can act only inside them, and only you can change them.</p>
      </header>

      {notice ? <Card className="bg-ok-soft ring-0 text-sm text-ok">{notice}</Card> : null}

      {active.error ? (
        <ErrorNote error={active.error} />
      ) : !active.data ? (
        <Card>
          <Skeleton lines={6} />
        </Card>
      ) : !m ? (
        <Empty>No active mandate yet. Until you sign one, Reins can only read and suggest.</Empty>
      ) : editing ? (
        <Editor base={m.policy} activeVersion={m.version} onCancel={() => setEditing(false)} onActivated={onActivated} />
      ) : (
        <Card>
          <SectionTitle
            action={
              <Button variant="secondary" className="min-h-9 px-3 text-xs" onClick={() => setEditing(true)}>
                Edit rules
              </Button>
            }
          >
            Mandate card · v{m.version}
          </SectionTitle>
          <ul className="space-y-2 text-sm">
            {m.readback.map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden className="text-ok">
                  ✓
                </span>
                {line}
              </li>
            ))}
          </ul>
          <p className="mt-4 font-mono text-[11px] text-grey-500">
            signed {dateTime(m.signedAt)} · via {m.createdVia} · hash {shortHash(m.policyHash)}
          </p>
        </Card>
      )}

      <Card>
        <SectionTitle>Version history</SectionTitle>
        {history.error ? (
          <ErrorNote error={history.error} />
        ) : !history.data ? (
          <Skeleton lines={3} />
        ) : history.data.versions.length === 0 ? (
          <Empty>No versions yet.</Empty>
        ) : (
          <ul className="divide-y divide-grey-100">
            {history.data.versions.map((v) => (
              <li key={v.version} className="py-2.5">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold">v{v.version}</span>
                  <Badge tone={v.status === "active" ? "lime" : "neutral"}>{v.status}</Badge>
                  {v.class !== "none" ? <Badge tone={CLASS_TONE[v.class]}>{v.class}</Badge> : null}
                  <span className="text-xs text-grey-500">
                    {dateTime(v.signedAt)} · {shortHash(v.policyHash)}
                  </span>
                </div>
                {v.diff.length ? <DiffList entries={v.diff} /> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function DiffList({ entries }: { entries: DiffEntry[] }) {
  return (
    <ul className="mt-1.5 space-y-1">
      {entries.map((e) => (
        <li key={e.path} className="flex flex-wrap items-center gap-1.5 text-xs">
          <Badge tone={CLASS_TONE[e.class]}>{e.class === "widening" ? "▲" : "▼"}</Badge>
          <span className="font-mono">{e.path}</span>
          <span className="text-grey-500">
            {show(e.from)} → <span className="font-semibold text-ink">{show(e.to)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Editor({ base, activeVersion, onCancel, onActivated }: { base: Policy; activeVersion: number; onCancel: () => void; onActivated: (r: ActivateResponse) => void }) {
  const [form, setForm] = useState<Form>(() => formFrom(base));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmWiden, setConfirmWiden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Any edit invalidates the reviewed preview: the user must sign exactly what they saw.
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setPreview(null);
    setConfirmWiden(false);
  };

  async function review() {
    setBusy(true);
    setErr(null);
    try {
      setPreview(await apiFetch<Preview>("/api/mandates/preview", { method: "POST", json: { draft: draftFrom(form, base) } }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function sign() {
    if (!preview) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await apiFetch<ActivateResponse>("/api/mandates/activate", {
        method: "POST",
        json: { candidate: preview.candidate, policyHash: preview.policyHash, baseVersion: preview.activeVersion, createdVia: "edit", confirmWidening: confirmWiden },
      });
      onActivated(r);
    } catch (e) {
      const code = e instanceof ApiRequestError ? e.code : undefined;
      setErr(
        code === "stale_base"
          ? "Your rules changed somewhere else while you were editing. Reload and try again."
          : code === "widening_not_confirmed"
            ? "This change gives Reins more room. Tick the confirmation first."
            : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }

  const widening = preview?.class === "widening";

  return (
    <Card>
      <SectionTitle>Edit rules · based on v{activeVersion}</SectionTitle>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Pay bills automatically up to (CNY)">
          <NumberInput value={form.autoPayMax} onChange={(v) => set("autoPayMax", v)} />
        </Field>
        <Field label="Total payments per day at most (CNY)">
          <NumberInput value={form.dailyCap} onChange={(v) => set("dailyCap", v)} />
        </Field>
        <Field label="Allowed payees (IDs, comma separated)" wide>
          <input
            value={form.payees}
            onChange={(e) => set("payees", e.target.value)}
            className="min-h-11 w-full rounded-xl bg-surface px-3 font-mono text-sm ring-1 ring-grey-300 focus:outline-none focus:ring-2 focus:ring-ink"
          />
        </Field>
        <Field label="New payees">
          <Choice value={form.newPayee} onChange={(v) => set("newPayee", v)} />
        </Field>
        <Field label="Cancel subscriptions">
          <Choice value={form.cancel} onChange={(v) => set("cancel", v)} />
        </Field>
        <Field label="Start subscriptions">
          <Choice value={form.subscribe} onChange={(v) => set("subscribe", v)} />
        </Field>
        <Field label="Free trials">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Toggle checked={form.trialsAuto} onChange={(v) => set("trialsAuto", v)} label="Cancel automatically" />
            {form.trialsAuto ? (
              <span className="flex items-center gap-1.5">
                <NumberInput value={form.trialDays} onChange={(v) => set("trialDays", v)} className="w-16" /> day(s) before they charge
              </span>
            ) : null}
          </div>
        </Field>
        <Field label="Buy prepaid packages">
          <Choice value={form.prepaidPurchase} onChange={(v) => set("prepaidPurchase", v)} />
        </Field>
        <Field label="Prepay at most (CNY, escrow only)">
          <NumberInput value={form.maxPrepay} onChange={(v) => set("maxPrepay", v)} />
        </Field>
        <Field label="Exit a prepaid plan automatically on">
          <div className="flex flex-wrap gap-3 text-sm">
            <Toggle checked={form.exitCourt} onChange={(v) => set("exitCourt", v)} label="Court enforcement" />
            <Toggle checked={form.exitClosure} onChange={(v) => set("exitClosure", v)} label="Closure notice" />
          </div>
        </Field>
        <Field label="FX margin before checking limits (%)">
          <NumberInput value={form.fxMargin} onChange={(v) => set("fxMargin", v)} max={10} />
        </Field>
      </div>

      {err ? <p className="mt-4 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p> : null}

      {preview ? (
        <div className="mt-5 space-y-4 rounded-xl bg-grey-50 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">Read it back before you sign</span>
            <Badge tone={CLASS_TONE[preview.class]}>{CLASS_TEXT[preview.class]}</Badge>
          </div>
          <ul className="space-y-1.5 text-sm">
            {preview.readback.map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden>•</span>
                {line}
              </li>
            ))}
          </ul>
          {preview.diff.length ? (
            <div>
              <div className="text-xs font-medium text-grey-500">Changes against v{preview.activeVersion}</div>
              <DiffList entries={preview.diff} />
            </div>
          ) : (
            <p className="text-sm text-grey-500">Nothing changed against v{preview.activeVersion}.</p>
          )}
          {widening ? (
            <label className="flex items-start gap-2 rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">
              <input type="checkbox" checked={confirmWiden} onChange={(e) => setConfirmWiden(e.target.checked)} className="mt-1 size-4" />
              I understand this gives Reins more room to act without asking me.
            </label>
          ) : null}
          <p className="font-mono text-[11px] text-grey-500">you are signing hash {shortHash(preview.policyHash)}</p>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        {preview ? (
          <Button onClick={sign} disabled={busy || preview.class === "none" || (widening && !confirmWiden)}>
            {busy ? "Signing…" : `Sign v${(preview.activeVersion ?? 0) + 1}`}
          </Button>
        ) : (
          <Button onClick={review} disabled={busy}>
            {busy ? "Checking…" : "Review changes"}
          </Button>
        )}
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`block ${wide ? "md:col-span-2" : ""}`}>
      <span className="mb-1.5 block text-xs font-medium text-grey-500">{label}</span>
      {children}
    </label>
  );
}

function NumberInput({ value, onChange, max, className = "" }: { value: number; onChange: (v: number) => void; max?: number; className?: string }) {
  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      max={max}
      value={value}
      onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
      className={`min-h-11 w-full rounded-xl bg-surface px-3 text-sm ring-1 ring-grey-300 focus:outline-none focus:ring-2 focus:ring-ink ${className}`}
    />
  );
}

function Choice({ value, onChange }: { value: "deny" | "confirm"; onChange: (v: "deny" | "confirm") => void }) {
  return (
    <div className="inline-flex rounded-xl bg-grey-100 p-1">
      {(["confirm", "deny"] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`min-h-9 rounded-lg px-3 text-xs font-semibold ${value === v ? "bg-surface text-ink shadow-sm" : "text-grey-500"}`}
        >
          {v === "confirm" ? "Ask me first" : "Never"}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4" />
      {label}
    </span>
  );
}
