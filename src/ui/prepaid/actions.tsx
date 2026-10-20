"use client";

// Prepaid actions the user starts (R4-07, R4-09): buy, check in, leave. Each one signs in this
// browser with the consumer key, sends only signatures to the server, and shows exactly what the
// Gate decided. Nothing here moves money: the server runs the action through the executor.

import { useState } from "react";
import type { Address, Hex } from "viem";
import type { OfferJson } from "@/src/server/chain/types";
import type { PrepaidOfferItem, PrepaidPlanItem } from "@/src/server/api-types";
import type { UserActionResponse } from "@/src/server/prepaid/user-actions";
import { postJson, useApi } from "../data";
import { Button, ChainLink } from "../components/primitives";
import { consumerAccount, ensureConsumerAccount, exportBackup } from "./consumer-key";
import { permitNonceReader, signPurchase, signRedeem, signVoluntaryExit, type SigningConfig } from "./sign";

type SimOffer = { offer: OfferJson; merchantSig: Hex | null };
type SimCheckin = { planId: string; sessionNo: number; deadline: number; merchantSig: Hex };
type Outcome = { kind: "ok" | "ask" | "stop"; text: string; tx?: UserActionResponse["tx"] };

const DENY_TEXT: Record<string, string> = {
  "prepaid.purchase_not_authorized": "Your signature did not match your saved key.",
  "prepaid.offer_invalid": "The gym's offer did not check out (terms or signature).",
  "prepaid.escrow_required": "Your rules only allow packages where the money is held safely.",
  "prepaid.over_max_prepay": "This is over your prepaid limit.",
  "prepaid.redeem_invalid": "The check-in did not verify: both you and the gym must sign the next session.",
  "prepaid.exit_voluntary_invalid": "Your signature to leave did not verify.",
  "global.kill_switch.on": "Reins is paused.",
};

function outcomeOf(r: UserActionResponse, done: string): Outcome {
  if (r.status === "succeeded") return { kind: "ok", text: done, tx: r.tx };
  if (r.status === "awaiting_approval") return { kind: "ask", text: "This needs your OK first. It is waiting in Home." };
  if (r.status === "denied") {
    const why = r.ruleIds.map((id) => DENY_TEXT[id]).find(Boolean);
    return { kind: "stop", text: `Blocked. ${why ?? "A rule check did not pass."} Nothing was paid.` };
  }
  return { kind: "stop", text: `It did not go through (${r.error ?? r.status}). Nothing was paid.` };
}

function useSigning() {
  return useApi<SigningConfig>("/api/prepaid/signing");
}

function OutcomeNote({ o }: { o: Outcome }) {
  const cls = o.kind === "ok" ? "bg-ok-bg text-ok" : o.kind === "ask" ? "bg-ask-bg text-ask" : "bg-stop-bg text-stop";
  return (
    <div role="status" className={`mt-3 rounded-field px-3 py-2 text-[14px] ${cls}`}>
      {o.text}
      {o.tx && (
        <div className="mt-1">
          <ChainLink hash={o.tx.hash} url={o.tx.simulated ? "" : `https://sepolia.basescan.org/tx/${o.tx.hash}`} />
        </div>
      )}
    </div>
  );
}

/** Buy with the money held safely (R4-07). */
export function BuyButton({ offer, onDone }: { offer: PrepaidOfferItem; onDone: () => void }) {
  const signing = useSigning();
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<Outcome | null>(null);
  const [confirm, setConfirm] = useState(false);

  async function buy() {
    if (signing.state !== "ready") return;
    setBusy(true);
    setOut(null);
    try {
      const g = await fetch(`/api/prepaid/gym/offer?offerId=${offer.id}`, { cache: "no-store" });
      const sim = g.ok ? ((await g.json()) as SimOffer) : null;
      if (!sim?.merchantSig) throw new Error("The gym has no signed offer right now.");
      const account = await ensureConsumerAccount();
      const cfg = signing.data;
      const body = await signPurchase(account, cfg, sim.offer, sim.merchantSig, {
        readNonce: cfg.rpcUrl && cfg.token ? permitNonceReader(cfg.rpcUrl, cfg.token.address as Address) : undefined,
      });
      const r = await postJson<UserActionResponse>("/api/prepaid/purchase", { offerId: offer.id, ...body });
      if (!r.ok) throw new Error(r.code ?? `HTTP ${r.status}`);
      setOut(outcomeOf(r.data, "Bought. The money is held safely and paid out one session at a time."));
      if (r.data.status === "succeeded") onDone();
    } catch (e) {
      setOut({ kind: "stop", text: `${(e as Error).message} Nothing was paid.` });
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  if (!offer.merchant.escrowSupported) {
    return (
      <p className="text-center text-[13px] text-muted">This gym does not hold the money safely, so Reins cannot buy it for your rules.</p>
    );
  }
  return (
    <div>
      {confirm ? (
        <div className="rounded-field border border-line p-3">
          <p className="text-[14px]">
            You sign the purchase in this browser. The money is held safely and the gym is paid one session at a time.
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="quiet" onClick={() => setConfirm(false)} disabled={busy}>
              Cancel
            </Button>
            <Button full onClick={buy} disabled={busy || signing.state !== "ready"}>
              {busy ? "Signing…" : "Sign and buy"}
            </Button>
          </div>
        </div>
      ) : (
        <Button full onClick={() => setConfirm(true)} disabled={signing.state !== "ready"}>
          Buy with money held safely
        </Button>
      )}
      {out && <OutcomeNote o={out} />}
    </div>
  );
}

/** Check in at the gym and leave early (R4-09). */
export function PlanActions({ plan, onDone }: { plan: PrepaidPlanItem; onDone: () => void }) {
  const signing = useSigning();
  const [busy, setBusy] = useState<"checkin" | "exit" | null>(null);
  const [out, setOut] = useState<Outcome | null>(null);
  const [leaving, setLeaving] = useState(false);
  const fee = plan.cancelFeeBps / 100;

  async function needAccount() {
    const a = await consumerAccount();
    if (!a) throw new Error("This browser does not hold the key for this package. Restore your key backup first.");
    return a;
  }

  async function checkin() {
    if (signing.state !== "ready") return;
    setBusy("checkin");
    setOut(null);
    try {
      const account = await needAccount();
      // Demo: the gym tablet's signature from the merchant simulator (in real life, a QR scan).
      const t = await fetch(`/api/prepaid/gym/checkin/${plan.id}`, { method: "POST" });
      if (!t.ok) throw new Error("The gym tablet did not sign this session.");
      const gym = (await t.json()) as SimCheckin;
      const consumerSig = await signRedeem(account, signing.data, { planId: plan.chainPlanId, sessionNo: gym.sessionNo, deadline: gym.deadline });
      const r = await postJson<UserActionResponse>(`/api/prepaid/plans/${plan.id}/checkin`, {
        sessionNo: gym.sessionNo,
        deadline: gym.deadline,
        consumerSig,
        merchantSig: gym.merchantSig,
      });
      if (!r.ok) throw new Error(r.code ?? `HTTP ${r.status}`);
      setOut(outcomeOf(r.data, `Session ${gym.sessionNo} used. One session price went to the gym.`));
      if (r.data.status === "succeeded") onDone();
    } catch (e) {
      setOut({ kind: "stop", text: `${(e as Error).message} Nothing was paid.` });
    } finally {
      setBusy(null);
    }
  }

  async function leave() {
    if (signing.state !== "ready") return;
    setBusy("exit");
    setOut(null);
    try {
      const account = await needAccount();
      const sig = await signVoluntaryExit(account, signing.data, plan.chainPlanId);
      const r = await postJson<UserActionResponse>(`/api/prepaid/plans/${plan.id}/exit`, sig);
      if (!r.ok) throw new Error(r.code ?? `HTTP ${r.status}`);
      setOut(outcomeOf(r.data, "You left the package. The unused money minus the fee is back with you."));
      if (r.data.status === "succeeded") onDone();
    } catch (e) {
      setOut({ kind: "stop", text: `${(e as Error).message} Nothing was paid.` });
    } finally {
      setBusy(null);
      setLeaving(false);
    }
  }

  const ready = signing.state === "ready";
  return (
    <div className="flex flex-col gap-2">
      <Button full onClick={checkin} disabled={!ready || busy !== null}>
        {busy === "checkin" ? "Signing…" : "Check in at the gym"}
      </Button>
      {leaving ? (
        <div className="rounded-field border border-stop p-3">
          <p className="text-[14px]">
            Leave now? The gym keeps a <span className="amount">{fee}%</span> fee; the rest of the unused money comes back to you. This cannot be undone.
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="quiet" onClick={() => setLeaving(false)} disabled={busy !== null}>
              Keep it
            </Button>
            <Button full variant="danger" onClick={leave} disabled={busy !== null}>
              {busy === "exit" ? "Signing…" : "Sign and leave"}
            </Button>
          </div>
        </div>
      ) : (
        <Button full variant="quiet" onClick={() => setLeaving(true)} disabled={!ready || busy !== null}>
          Leave this package
        </Button>
      )}
      {out && <OutcomeNote o={out} />}
    </div>
  );
}

/** Encrypted key backup download (§15.3). */
export function KeyBackup() {
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function download() {
    setMsg(null);
    try {
      const blob = await exportBackup(pw);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "reins-key-backup.json";
      a.click();
      URL.revokeObjectURL(url);
      setPw("");
      setMsg("Saved. Keep the file and the password somewhere safe; Reins cannot recover them.");
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  return (
    <div className="rounded-field border border-line p-3">
      <p className="text-[14px] font-semibold">Back up your signing key</p>
      <p className="mt-1 text-[13px] text-muted">Your key lives only in this browser. Without a backup, a new device cannot check in or leave.</p>
      <div className="mt-2 flex gap-2">
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="Backup password"
          aria-label="Backup password"
          className="min-h-11 flex-1 rounded-field border border-line bg-page px-3 text-[16px] lg:text-[15px]"
        />
        <Button variant="outline" onClick={download} disabled={pw.length < 8}>
          Download
        </Button>
      </div>
      {msg && <p className="mt-2 text-[13px]">{msg}</p>}
    </div>
  );
}
