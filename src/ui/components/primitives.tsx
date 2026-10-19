// Small building blocks used on every screen (docs/ui-direction.md §9).

import {
  ArrowSquareOut,
  CheckCircle,
  HandPalm,
  Lightbulb,
  Prohibit,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { moneyParts, shortHash, type MoneyLike } from "../format";
import { STATUS_LABEL, type Status } from "../words";

// ---- Money: mono, decimals lighter ------------------------------------------------------

const MONEY_SIZE = {
  sm: "text-[15px]",
  md: "text-[17px]",
  lg: "text-[28px] lg:text-[32px] font-medium tracking-tight",
  xl: "text-[40px] lg:text-[48px] font-medium tracking-tight leading-none",
} as const;

export function Money({
  value,
  size = "sm",
  decimals = true,
  className = "",
  mutedClass = "text-muted",
}: {
  value: MoneyLike;
  size?: keyof typeof MONEY_SIZE;
  decimals?: boolean;
  className?: string;
  mutedClass?: string;
}) {
  const p = moneyParts(value, { decimals });
  return (
    <span className={`num whitespace-nowrap ${MONEY_SIZE[size]} ${className}`}>
      {p.sign}
      {p.symbol}
      {p.whole}
      {p.frac && <span className={mutedClass}>{p.frac}</span>}
    </span>
  );
}

// ---- Status badge: icon + label + colour, never colour alone ----------------------------

const STATUS_STYLE: Record<Status, { cls: string; icon: Icon }> = {
  done: { cls: "bg-ok-bg text-ok", icon: CheckCircle },
  ask: { cls: "bg-ask-bg text-ask", icon: HandPalm },
  suggest: { cls: "bg-hint-bg text-hint", icon: Lightbulb },
  blocked: { cls: "bg-stop-bg text-stop", icon: Prohibit },
};

export function StatusBadge({ status, compact = false }: { status: Status; compact?: boolean }) {
  const { cls, icon: I } = STATUS_STYLE[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold ${cls}`}
      aria-label={`Status: ${STATUS_LABEL[status]}`}
    >
      <I size={14} weight="bold" aria-hidden />
      {compact ? null : STATUS_LABEL[status]}
    </span>
  );
}

export function StatusIcon({ status }: { status: Status }) {
  const { cls, icon: I } = STATUS_STYLE[status];
  return (
    <span className={`grid size-9 shrink-0 place-items-center rounded-full ${cls}`} aria-label={STATUS_LABEL[status]}>
      <I size={18} weight="bold" aria-hidden />
    </span>
  );
}

// ---- Tags ------------------------------------------------------------------------------

export function Tag({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full bg-sunken px-2 py-0.5 text-[12px] font-medium text-muted ${className}`}>
      {children}
    </span>
  );
}

export function SimulatedTag() {
  return <Tag>Simulated</Tag>;
}

export function SampleTag() {
  return (
    <Tag className="border border-dashed border-line bg-transparent" >
      Sample data
    </Tag>
  );
}

/** On-chain item: short hash, Basescan link, and the test-token notice (architecture §15.3). */
export function ChainLink({ hash, url }: { hash: string; url: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="num inline-flex items-center gap-1 text-[13px] text-hint underline-offset-2 hover:underline"
      >
        {shortHash(hash)}
        <ArrowSquareOut size={14} aria-label="opens Basescan" />
      </a>
      <Tag>Test token, no value</Tag>
    </span>
  );
}

// ---- Label and value rows (the Summary panel pattern) ----------------------------------

export function Rows({ children }: { children: ReactNode }) {
  return <dl className="divide-y divide-line">{children}</dl>;
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] items-baseline gap-3 py-3 text-[15px]">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </div>
  );
}

// ---- Agent's note: secondary, labelled, never first -------------------------------------

export function AgentNote({ children }: { children: ReactNode }) {
  return (
    <p className="text-[13px] leading-relaxed text-muted">
      <span className="font-semibold">Agent&apos;s note: </span>
      {children}
    </p>
  );
}

// ---- Buttons ---------------------------------------------------------------------------

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "quiet" | "outline" | "danger";
  full?: boolean;
};

const BUTTON = {
  primary: "bg-ink text-page hover:opacity-90",
  quiet: "text-ink hover:bg-sunken",
  outline: "border border-line text-ink hover:bg-sunken",
  danger: "border border-stop text-stop hover:bg-stop-bg",
} as const;

export function Button({ variant = "primary", full = false, className = "", ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={`inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full px-5 text-[15px] font-semibold transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 ${BUTTON[variant]} ${full ? "w-full" : ""} ${className}`}
    />
  );
}

// ---- Section heading inside a list ------------------------------------------------------

export function GroupLabel({ children }: { children: ReactNode }) {
  return <h3 className="px-1 pb-1 pt-5 text-[13px] font-semibold text-muted first:pt-1">{children}</h3>;
}
