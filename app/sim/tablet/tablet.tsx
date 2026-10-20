"use client";

import { useState } from "react";
import { signNextSession, type TabletResult } from "./actions";

export function GymTablet() {
  const [planId, setPlanId] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<TabletResult | null>(null);

  async function sign() {
    setBusy(true);
    setRes(await signNextSession(planId.trim()));
    setBusy(false);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-10">
      <div>
        <p className="text-[13px] font-semibold uppercase tracking-wide text-muted">Simulated gym tablet</p>
        <h1 className="mt-1 text-[28px] font-semibold">FitBox Futian check-in</h1>
        <p className="mt-2 text-[15px] text-muted">Enter the member&apos;s plan number. The tablet signs today&apos;s session; the member confirms it in Reins.</p>
      </div>
      <label className="block text-[14px] font-semibold" htmlFor="plan">
        Plan number
        <input
          id="plan"
          inputMode="numeric"
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
          className="mt-2 min-h-14 w-full rounded-field border border-line bg-surface px-4 text-[22px] tabular-nums"
        />
      </label>
      <button
        onClick={sign}
        disabled={busy || !planId.trim()}
        className="min-h-14 rounded-full bg-ink text-[17px] font-semibold text-page disabled:opacity-40"
      >
        {busy ? "Signing…" : "Sign today's session"}
      </button>
      {res &&
        (res.ok ? (
          <p role="status" className="rounded-card bg-ok-bg p-4 text-[16px] text-ok">
            Session <span className="tabular-nums">{res.sessionNo}</span> of plan <span className="tabular-nums">{res.planId}</span> signed by the gym. Ask the
            member to tap “Check in at the gym” in Reins within 10 minutes.
          </p>
        ) : (
          <p role="alert" className="rounded-card bg-stop-bg p-4 text-[16px] text-stop">
            {res.error}
          </p>
        ))}
    </main>
  );
}
