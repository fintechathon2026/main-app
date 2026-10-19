// Loading, empty and error states (docs/ui-direction.md §10). Errors are fail-safe and say
// that no money moved.

import { ArrowClockwise } from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";

export function SkeletonList({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-1" aria-busy="true" aria-label="Loading">
      <div className="mb-4 h-10 w-40 animate-pulse rounded-field bg-sunken motion-reduce:animate-none" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 py-3">
          <div className="size-9 animate-pulse rounded-full bg-sunken motion-reduce:animate-none" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-1/2 animate-pulse rounded-full bg-sunken motion-reduce:animate-none" />
            <div className="h-3 w-1/3 animate-pulse rounded-full bg-sunken motion-reduce:animate-none" />
          </div>
          <div className="h-3.5 w-16 animate-pulse rounded-full bg-sunken motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-line px-6 py-10 text-center">
      <p className="text-[15px] font-semibold">{title}</p>
      {children && <div className="mt-1 text-[14px] text-muted">{children}</div>}
    </div>
  );
}

export function ErrorState({ onRetry }: { onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-card border border-line bg-surface px-6 py-8 text-center">
      <p className="text-[15px] font-semibold">Reins could not load this.</p>
      <p className="mt-1 text-[14px] text-muted">No money was moved.</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-5 text-[15px] font-semibold hover:bg-sunken"
        >
          <ArrowClockwise size={18} aria-hidden />
          Try again
        </button>
      )}
    </div>
  );
}
