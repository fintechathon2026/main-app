"use client";

// App frame (docs/ui-direction.md §7): desktop sidebar at 1024 px and up, floating pill tab bar
// below it. "Pause everything" is always one tap away.

import {
  ArrowsClockwise,
  ClipboardText,
  House,
  ListChecks,
  Signature,
  Ticket,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Logo } from "../components/logo";
import { PauseProvider, PauseButton, PausedBanner } from "./pause";

type NavItem = { href: string; label: string; short: string; icon: Icon };

const NAV: NavItem[] = [
  { href: "/", label: "Home", short: "Home", icon: House },
  { href: "/activity", label: "Activity", short: "Activity", icon: ListChecks },
  { href: "/subscriptions", label: "Subscriptions", short: "Subs", icon: ArrowsClockwise },
  { href: "/prepaid", label: "Prepaid", short: "Prepaid", icon: Ticket },
  { href: "/rules", label: "Your rules", short: "Rules", icon: Signature },
];

const EVIDENCE: NavItem = { href: "/evidence", label: "Evidence", short: "Evidence", icon: ClipboardText };

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isHome = pathname === "/";
  return (
    <PauseProvider>
      <div className="min-h-dvh lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
        <Sidebar pathname={pathname} />
        <div className="min-w-0">
          {!isHome && <MobileTopBar />}
          <PausedBanner />
          <main className={`px-4 pb-32 lg:px-10 lg:pb-12 lg:pt-8 ${isHome ? "" : "pt-2"}`}>{children}</main>
        </div>
        <TabBar pathname={pathname} />
      </div>
    </PauseProvider>
  );
}

function Sidebar({ pathname }: { pathname: string }) {
  return (
    <nav
      aria-label="Main"
      className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface px-4 py-6 lg:flex"
    >
      <Link href="/" className="mb-8 px-3 text-[26px] text-ink" aria-label="Reins home">
        <Logo />
      </Link>
      <ul className="space-y-1">
        {NAV.map((item) => (
          <SideLink key={item.href} item={item} active={isActive(pathname, item.href)} />
        ))}
      </ul>
      <div className="my-4 border-t border-line" />
      <ul>
        <SideLink item={EVIDENCE} active={isActive(pathname, EVIDENCE.href)} />
      </ul>
      <div className="mt-auto">
        <PauseButton full />
      </div>
    </nav>
  );
}

function SideLink({ item, active }: { item: NavItem; active: boolean }) {
  const I = item.icon;
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={`flex min-h-11 items-center gap-3 rounded-full px-3 text-[15px] font-medium transition ${
          active ? "bg-band text-band-ink" : "text-muted hover:bg-sunken hover:text-ink"
        }`}
      >
        <I size={20} weight={active ? "fill" : "regular"} className={active ? "text-lime" : ""} aria-hidden />
        {item.label}
      </Link>
    </li>
  );
}

function MobileTopBar() {
  return (
    <div className="flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] lg:hidden">
      <Link href="/" className="text-[22px] text-ink" aria-label="Reins home">
        <Logo />
      </Link>
      <PauseButton compact />
    </div>
  );
}

function TabBar({ pathname }: { pathname: string }) {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 mx-auto max-w-md rounded-full bg-band p-1.5 shadow-pop lg:hidden"
    >
      <ul className="grid grid-cols-5">
        {NAV.map((item) => {
          const active = isActive(pathname, item.href);
          const I = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-full text-[11px] font-medium ${
                  active ? "bg-white/10 text-band-ink" : "text-band-muted"
                }`}
              >
                <I size={22} weight={active ? "fill" : "regular"} className={active ? "text-lime" : ""} aria-hidden />
                {item.short}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
