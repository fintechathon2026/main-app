// Browser sign-in client. The server reads the Supabase auth cookie this client writes
// (src/server/auth/session.ts), so the two stay in step. With no Supabase settings (fixtures or
// demo mode) there is no sign-in, and `authClient()` returns null.

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

export function authClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  client = url && anonKey ? createBrowserClient(url, anonKey) : null;
  return client;
}

/** Only follow same-site paths after sign-in, never another site. */
export function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : "/";
}
