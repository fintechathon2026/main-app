"use client";

// "Where did this number come from?" Tap on mobile, hover or focus on desktop
// (docs/ui-direction.md §4 rule 2).

import { Info } from "@phosphor-icons/react/dist/ssr";
import { useState, type ReactNode } from "react";

export function SourceInfo({ children, label = "Where this comes from" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-flex align-middle"
      onPointerEnter={(e) => e.pointerType === "mouse" && setOpen(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setOpen(false)}
    >
      <button
        type="button"
        onClick={(e) => ((e.nativeEvent as PointerEvent).pointerType === "mouse" ? setOpen(true) : setOpen((o) => !o))}
        onBlur={() => setOpen(false)}
        aria-expanded={open}
        aria-label={label}
        className="-m-2 grid size-8 place-items-center rounded-full p-2 text-muted hover:text-ink"
      >
        <Info size={16} aria-hidden />
      </button>
      {open && (
        <span
          role="tooltip"
          className="anim-fade absolute left-1/2 top-full z-30 mt-2 w-64 -translate-x-1/2 rounded-field border border-line bg-surface p-3 text-left text-[13px] font-normal leading-snug text-ink shadow-pop"
        >
          {children}
        </span>
      )}
    </span>
  );
}
