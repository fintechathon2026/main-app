"use client";

// Sends people who are not signed in to /login. Without Supabase settings there is no sign-in,
// so the app opens straight away (fixtures and demo mode).

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { authClient } from "./client";

export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<"checking" | "in" | "out">(() => (authClient() ? "checking" : "in"));

  useEffect(() => {
    const supabase = authClient();
    if (!supabase) return;
    // Fires once with the current session, then on every sign-in and sign-out.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setStatus(session ? "in" : "out"));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (status === "out") router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [status, pathname, router]);

  if (status !== "in") return <div className="min-h-dvh bg-page" aria-busy="true" />;
  return children;
}
