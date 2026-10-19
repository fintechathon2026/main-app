"use client";

// The page the sign-in link opens. The Supabase client reads the code in the address while it
// starts, so asking for the session waits for that to finish.

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { authClient, safeNext } from "../auth/client";

export function AuthCallbackScreen() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const supabase = authClient();
    if (!supabase) {
      router.replace("/");
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace(next);
      else setFailed(true);
    });
  }, [router, next]);

  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      {failed ? (
        <div role="alert">
          <p className="text-[20px] font-semibold">This link did not work.</p>
          <p className="mt-1 text-[15px] text-muted">It may have been used already or have expired.</p>
          <Link
            href="/login"
            className="mt-6 inline-flex min-h-11 items-center rounded-full bg-ink px-5 text-[15px] font-semibold text-page hover:opacity-90"
          >
            Get a new link
          </Link>
        </div>
      ) : (
        <p role="status" className="text-[15px] text-muted">
          Signing you in
        </p>
      )}
    </main>
  );
}
