"use client";

import { SignOut } from "@phosphor-icons/react/dist/ssr";
import { useRouter } from "next/navigation";
import { authClient } from "./client";

/** Quiet text button. Shows nothing when sign-in is not set up. */
export function SignOutButton({ full = false }: { full?: boolean }) {
  const router = useRouter();
  if (!authClient()) return null;
  return (
    <button
      onClick={async () => {
        await authClient()?.auth.signOut();
        router.replace("/login");
      }}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 text-[14px] font-semibold text-muted hover:bg-sunken hover:text-ink ${full ? "w-full" : ""}`}
    >
      <SignOut size={18} aria-hidden />
      Sign out
    </button>
  );
}
