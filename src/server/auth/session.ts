// Minimal session resolution for route handlers (architecture §13): request bodies never carry
// userId. Created by the Reader/ingest work; the auth owner may replace it, keeping the exports.
//
// 1. Supabase configured: the access token from `Authorization: Bearer` or the Supabase auth
//    cookie (`sb-<ref>-auth-token`, possibly chunked and base64-prefixed) is verified by the
//    Supabase Auth server (`GET /auth/v1/user`); the JWT is never trusted unverified.
// 2. Otherwise, only when REINS_DEMO_AUTH=1 and not in production: the `x-demo-user` header.

export type Session = { userId: string; accessToken?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (s: string) => UUID_RE.test(s);

function supabaseConfig(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && anonKey ? { url, anonKey } : null;
}

function parseCookies(header: string | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const name = part.slice(0, i).trim();
    try {
      out.set(name, decodeURIComponent(part.slice(i + 1).trim()));
    } catch {
      // ignore malformed cookie values
    }
  }
  return out;
}

/** Extract the access token from Supabase's auth cookie, joining `.0`, `.1` chunks. */
export function accessTokenFromCookies(cookieHeader: string | null): string | null {
  const cookies = parseCookies(cookieHeader);
  const bases = new Set<string>();
  for (const name of cookies.keys()) {
    const m = /^(sb-[A-Za-z0-9-]+-auth-token)(\.\d+)?$/.exec(name);
    if (m) bases.add(m[1]);
  }
  for (const base of bases) {
    let raw = cookies.get(base);
    if (raw === undefined) {
      const chunks: string[] = [];
      for (let i = 0; cookies.has(`${base}.${i}`); i++) chunks.push(cookies.get(`${base}.${i}`)!);
      raw = chunks.join("");
    }
    if (!raw) continue;
    try {
      const json = raw.startsWith("base64-") ? Buffer.from(raw.slice(7), "base64url").toString("utf8") : raw;
      const parsed = JSON.parse(json) as { access_token?: unknown } | unknown[];
      const token = Array.isArray(parsed) ? parsed[0] : (parsed as { access_token?: unknown }).access_token;
      if (typeof token === "string" && token.length > 0) return token;
    } catch {
      // not a session cookie we understand
    }
  }
  return null;
}

async function verifySupabaseToken(cfg: { url: string; anonKey: string }, token: string): Promise<string | null> {
  const res = await fetch(new URL("/auth/v1/user", cfg.url), {
    headers: { apikey: cfg.anonKey, authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return null;
  const user = (await res.json()) as { id?: unknown };
  return typeof user.id === "string" && isUuid(user.id) ? user.id : null;
}

export async function getSession(req: Request): Promise<Session | null> {
  const cfg = supabaseConfig();
  if (cfg) {
    const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1] ?? null;
    const token = bearer ?? accessTokenFromCookies(req.headers.get("cookie"));
    if (!token) return null;
    const userId = await verifySupabaseToken(cfg, token);
    return userId ? { userId, accessToken: token } : null;
  }
  if (process.env.REINS_DEMO_AUTH === "1" && process.env.NODE_ENV !== "production") {
    const demo = req.headers.get("x-demo-user")?.trim() ?? "";
    return isUuid(demo) ? { userId: demo.toLowerCase() } : null;
  }
  return null;
}

export async function getSessionUserId(req: Request): Promise<string | null> {
  return (await getSession(req))?.userId ?? null;
}
