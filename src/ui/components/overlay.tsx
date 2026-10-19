"use client";

// Bottom sheet (mobile) and centred modal (desktop or confirmations). Escape closes, focus
// moves into the panel, the page behind does not scroll.

import { X } from "@phosphor-icons/react/dist/ssr";
import { useEffect, useRef, type ReactNode } from "react";

function useOverlay(open: boolean, onClose: () => void) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus();
    };
  }, [open, onClose]);
  return panel;
}

export function BottomSheet({
  open,
  onClose,
  label,
  children,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const panel = useOverlay(open, onClose);
  if (!open) return null;
  return (
    <div className={`fixed inset-0 z-40 ${className}`}>
      <div className="anim-backdrop absolute inset-0 bg-[rgb(22_22_27/0.45)]" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="anim-sheet absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col rounded-t-card bg-surface shadow-sheet outline-none"
      >
        <div className="relative flex shrink-0 justify-center pb-1 pt-2.5">
          <span className="h-1 w-10 rounded-full bg-line" aria-hidden />
          <button
            onClick={onClose}
            className="absolute right-3 top-2 grid size-11 place-items-center rounded-full text-muted hover:bg-sunken"
            aria-label="Close"
          >
            <X size={20} aria-hidden />
          </button>
        </div>
        <div className="overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
}) {
  const panel = useOverlay(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-end p-0 sm:place-items-center sm:p-6">
      <div className="anim-backdrop absolute inset-0 bg-[rgb(22_22_27/0.45)]" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="anim-fade relative w-full max-w-md rounded-t-card bg-surface p-6 shadow-pop outline-none sm:rounded-card"
      >
        {children}
      </div>
    </div>
  );
}
