// Small component kit (R4-01). Server-safe: no hooks, no client directive.

import type { ReactNode } from "react";
import type { ChainTxRef, SourceRef } from "@/src/server/api-types";
import { shortHash, sourceLabel } from "../_lib/format";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl bg-surface p-4 shadow-[0_1px_0_rgba(18,19,15,0.06)] ring-1 ring-grey-100 ${className}`}>{children}</section>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-sm font-semibold tracking-tight text-ink">{children}</h2>
      {action}
    </div>
  );
}

type Tone = "neutral" | "lime" | "lavender" | "danger" | "warn" | "ok";
const TONES: Record<Tone, string> = {
  neutral: "bg-grey-100 text-ink-soft",
  lime: "bg-lime text-ink",
  lavender: "bg-lavender text-ink",
  danger: "bg-danger-soft text-danger",
  warn: "bg-warn-soft text-warn",
  ok: "bg-ok-soft text-ok",
};

export function Badge({ children, tone = "neutral", title }: { children: ReactNode; tone?: Tone; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-5 ${TONES[tone]}`}>
      {children}
    </span>
  );
}

/** Data-origin tag; simulated data always says so (PRD FR2.8a). */
export function SourceTag({ source }: { source: SourceRef }) {
  const simulated = source.simulated || source.origin === "simulated";
  return (
    <Badge tone={simulated ? "warn" : source.origin === "document" || source.origin === "web" ? "lavender" : "neutral"} title={source.sourceId}>
      {simulated ? "simulated" : `from ${sourceLabel(source)}`}
    </Badge>
  );
}

/** On-chain items show the hash with an explorer link and the test-token tag (§15.3). */
export function TxLink({ tx }: { tx: ChainTxRef }) {
  if (tx.simulated) {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-xs text-ink-soft">
        {shortHash(tx.hash)} <Badge tone="warn">simulated</Badge>
      </span>
    );
  }
  return (
    <a href={tx.explorerUrl} target="_blank" rel="noreferrer" className="font-mono text-xs text-lavender-strong underline-offset-2 hover:underline">
      tx {shortHash(tx.hash)} ↗
    </a>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-grey-500">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tracking-tight">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-grey-500">{hint}</div> : null}
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  const styles = {
    primary: "bg-ink text-white hover:bg-ink-soft",
    secondary: "bg-surface text-ink ring-1 ring-grey-300 hover:bg-grey-50",
    danger: "bg-danger text-white hover:opacity-90",
    ghost: "text-ink-soft hover:bg-grey-100",
  }[variant];
  return (
    <button
      {...rest}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-grey-50 px-3 py-6 text-center text-sm text-grey-500">{children}</p>;
}

/** Fail-safe error copy (PRD §18.4). */
export function ErrorNote({ error }: { error: Error }) {
  return (
    <p className="rounded-xl bg-danger-soft px-3 py-3 text-sm text-danger">
      Could not load this ({error.message}). No money was moved.
    </p>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2" aria-busy="true">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-4 animate-pulse rounded bg-grey-100" style={{ width: `${90 - i * 15}%` }} />
      ))}
    </div>
  );
}
