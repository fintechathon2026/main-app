"use client";

// Sign in: one email field, a link by email, no password. Opens the app after the link is used.

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { authClient, safeNext } from "../auth/client";
import { Logo } from "../components/logo";
import { Button } from "../components/primitives";

type State = "idle" | "sending" | "sent" | "failed";

export function LoginScreen() {
  const next = safeNext(useSearchParams().get("next"));
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");
  const supabase = authClient();

  async function send() {
    if (!supabase) return;
    setState("sending");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    setState(error ? "failed" : "sent");
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Logo className="text-[30px] text-ink" symbolColor="currentColor" />
        <div className="mt-8 rounded-card border border-line bg-surface p-6">
          {!supabase ? (
            <>
              <h1 className="text-[22px] font-semibold tracking-tight">Sign in is not set up</h1>
              <p className="mt-2 text-[15px] text-muted">
                This copy of Reins has no sign in connected, so it opens without one. Nothing is wrong with your account.
              </p>
              <Link
                href="/"
                className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-ink px-5 text-[15px] font-semibold text-page hover:opacity-90"
              >
                Open Reins
              </Link>
            </>
          ) : state === "sent" ? (
            <div role="status">
              <h1 className="text-[22px] font-semibold tracking-tight">Check your email</h1>
              <p className="mt-2 text-[15px] text-muted">
                We sent a sign-in link to <span className="font-semibold text-ink">{email.trim()}</span>. It works once. You can
                close this tab.
              </p>
              <Button variant="quiet" full className="mt-6" onClick={() => setState("idle")}>
                Use a different email
              </Button>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <h1 className="text-[22px] font-semibold tracking-tight">Sign in</h1>
              <p className="mt-2 text-[15px] text-muted">We will email you a link. No password needed.</p>
              <label htmlFor="email" className="mt-6 block text-[14px] font-semibold">
                Email
              </label>
              <input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="mt-2 min-h-12 w-full rounded-field border border-line bg-page px-3 text-[16px] placeholder:text-muted focus:border-ink focus:outline-none lg:text-[15px]"
              />
              {state === "failed" && (
                <p role="alert" className="mt-3 rounded-field bg-stop-bg px-3 py-2 text-[14px] text-stop">
                  We could not send the link. Check the address and try again.
                </p>
              )}
              <Button type="submit" full className="mt-5" disabled={state === "sending" || !email.trim()}>
                {state === "sending" ? "Sending" : "Email me a sign-in link"}
              </Button>
            </form>
          )}
        </div>
        <p className="mt-6 text-center text-[13px] text-muted">Reins only acts inside the rules you signed.</p>
      </div>
    </main>
  );
}
