"use client";

// Fail-safe error screen (docs/ui-direction.md §10): say plainly that no money moved.

import { ErrorState } from "@/src/ui/components/states";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="pt-10">
      <ErrorState onRetry={reset} />
    </div>
  );
}
