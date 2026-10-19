"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApi } from "../_lib/use-api";
import type { ApprovalsResponse } from "@/app/api/approvals/_lib/cards";

const LINKS = [
  { href: "/", label: "Home", icon: "◎" },
  { href: "/approvals", label: "Approvals", icon: "✓" },
  { href: "/chat", label: "Chat", icon: "✦" },
  { href: "/subscriptions", label: "Subscriptions", icon: "↻" },
  { href: "/prepaid", label: "Prepaid", icon: "▣" },
] as const;

function usePendingCount(): number {
  const { data } = useApi<ApprovalsResponse>("/api/approvals?status=pending", { pollMs: 10_000 });
  return data?.items.length ?? 0;
}

export function Nav() {
  const pathname = usePathname();
  const pending = usePendingCount();
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-grey-100 bg-surface px-4 py-6 md:flex">
        <Link href="/" className="mb-8 flex items-center gap-2 px-2">
          <span className="grid size-8 place-items-center rounded-lg bg-lime font-bold text-ink">R</span>
          <span className="text-lg font-semibold tracking-tight">Reins</span>
        </Link>
        <nav className="flex flex-col gap-1">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition ${
                active(l.href) ? "bg-ink text-white" : "text-ink-soft hover:bg-grey-100"
              }`}
            >
              <span aria-hidden className="w-4 text-center">{l.icon}</span>
              {l.label}
              {l.href === "/approvals" && pending > 0 ? (
                <span className="ml-auto rounded-full bg-lime px-2 text-xs font-semibold text-ink" aria-label={`${pending} waiting`}>
                  {pending}
                </span>
              ) : null}
            </Link>
          ))}
        </nav>
        <p className="mt-auto px-2 text-xs leading-relaxed text-grey-500">
          Reins acts only inside your signed mandate. Sandbox data; prepaid uses a test token with no value.
        </p>
      </aside>

      {/* Mobile bottom bar */}
      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-grey-100 bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
              active(l.href) ? "text-ink" : "text-grey-500"
            }`}
          >
            <span aria-hidden className={`text-base ${active(l.href) ? "rounded-md bg-lime px-2" : ""}`}>{l.icon}</span>
            {l.label}
            {l.href === "/approvals" && pending > 0 ? (
              <span className="absolute right-[22%] top-1.5 size-2 rounded-full bg-danger" aria-label={`${pending} waiting`} />
            ) : null}
          </Link>
        ))}
      </nav>
    </>
  );
}
