"use client";

// List + detail (docs/ui-direction.md §7). Desktop: the detail fills a right pane next to the
// list. Mobile: the same detail opens as a bottom sheet. One component, CSS decides.

import { useEffect, useState, type ReactNode } from "react";
import { BottomSheet } from "./overlay";

export function MasterDetail({
  list,
  detail,
  detailLabel,
  onClose,
  placeholder,
}: {
  list: ReactNode;
  detail: ReactNode | null;
  detailLabel: string;
  onClose: () => void;
  placeholder?: ReactNode;
}) {
  const isDesktop = useIsDesktop();
  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-8 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0">{list}</div>
      <aside className="hidden lg:block" aria-label={detailLabel}>
        <div className="sticky top-8 max-h-[calc(100dvh-4rem)] overflow-y-auto rounded-card border border-line bg-surface p-6">
          {detail ? (
            <div key={detailLabel} className="anim-fade">
              {detail}
            </div>
          ) : (
            (placeholder ?? <p className="py-16 text-center text-[14px] text-muted">Select an item to see the details.</p>)
          )}
        </div>
      </aside>
      <BottomSheet open={!isDesktop && detail !== null} onClose={onClose} label={detailLabel} className="lg:hidden">
        {detail}
      </BottomSheet>
    </div>
  );
}

/** True at 1024 px and up (Tailwind `lg`). False during server render. */
export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return desktop;
}
