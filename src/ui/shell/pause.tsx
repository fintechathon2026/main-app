"use client";

// "Pause everything" (kill switch, architecture §8: POST /api/kill-switch, owner R3). The UI
// only shows "paused" after the server confirms; it never pretends to have stopped anything.

import { Pause, Play } from "@phosphor-icons/react/dist/ssr";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Button } from "../components/primitives";
import { Modal } from "../components/overlay";
import { postJson } from "../data";

type PauseCtx = { paused: boolean; ask: () => void; resume: () => void };
const Ctx = createContext<PauseCtx | null>(null);

export function usePause(): PauseCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePause outside PauseProvider");
  return v;
}

export function PauseProvider({ children }: { children: ReactNode }) {
  const [paused, setPaused] = useState(false);
  const [confirming, setConfirming] = useState<"pause" | "resume" | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const close = useCallback(() => {
    setConfirming(null);
    setFailed(false);
  }, []);

  async function confirm() {
    if (!confirming) return;
    setBusy(true);
    setFailed(false);
    const r = await postJson<{ enabled: boolean }>("/api/kill-switch", { enabled: confirming === "pause" });
    setBusy(false);
    if (!r.ok) return setFailed(true);
    setPaused(confirming === "pause");
    setConfirming(null);
  }

  const ask = useCallback(() => setConfirming("pause"), []);
  const resume = useCallback(() => setConfirming("resume"), []);

  return (
    <Ctx.Provider value={{ paused, ask, resume }}>
      {children}
      <Modal open={confirming !== null} onClose={close} label={confirming === "pause" ? "Pause everything" : "Resume"}>
        {confirming === "pause" ? (
          <>
            <h2 className="text-[20px] font-semibold">Pause all payments and cancellations?</h2>
            <p className="mt-2 text-[15px] text-muted">
              Reins will stop doing anything with your money until you resume. Bills will not be paid automatically.
            </p>
          </>
        ) : (
          <>
            <h2 className="text-[20px] font-semibold">Resume Reins?</h2>
            <p className="mt-2 text-[15px] text-muted">Reins will act again, only inside your rules.</p>
          </>
        )}
        {failed && (
          <p role="alert" className="mt-4 rounded-field bg-stop-bg px-3 py-2 text-[14px] text-stop">
            That did not go through. Nothing changed. Try again.
          </p>
        )}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="quiet" onClick={close}>
            Cancel
          </Button>
          <Button variant={confirming === "pause" ? "danger" : "primary"} onClick={confirm} disabled={busy}>
            {confirming === "pause" ? "Pause everything" : "Resume"}
          </Button>
        </div>
      </Modal>
    </Ctx.Provider>
  );
}

/** Outline button. `compact` = icon only on mobile bars; `onBand` = for the dark Home header. */
export function PauseButton({ full = false, compact = false, onBand = false }: { full?: boolean; compact?: boolean; onBand?: boolean }) {
  const { paused, ask, resume } = usePause();
  const I = paused ? Play : Pause;
  const label = paused ? "Resume" : "Pause everything";
  const tone = onBand
    ? "border-white/25 text-band-ink hover:bg-white/10"
    : "border-line text-ink hover:bg-sunken";
  return (
    <button
      onClick={paused ? resume : ask}
      aria-label={label}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full border px-4 text-[14px] font-semibold transition active:translate-y-px ${tone} ${
        full ? "w-full" : ""
      } ${compact ? "size-11 px-0" : ""}`}
    >
      <I size={18} weight="bold" aria-hidden />
      {!compact && label}
    </button>
  );
}

export function PausedBanner() {
  const { paused, resume } = usePause();
  if (!paused) return null;
  return (
    <div role="status" className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-card bg-stop-bg px-4 py-3 text-stop lg:mx-10 lg:mt-8">
      <p className="text-[14px] font-semibold">Everything is paused. No payments or cancellations will run.</p>
      <button onClick={resume} className="min-h-11 shrink-0 rounded-full px-3 text-[14px] font-semibold underline-offset-2 hover:underline">
        Resume
      </button>
    </div>
  );
}
