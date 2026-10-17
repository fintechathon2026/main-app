// Document byte storage (architecture §10.2, §16.2). Supabase Storage private bucket when
// configured; a local `.data/documents/` directory in development. Bytes are only ever read by
// the Reader job.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

export interface DocumentStorage {
  /** Store bytes under `key`; idempotent for identical content. Returns a storage_ref. */
  put(key: string, bytes: Uint8Array, contentType: string): Promise<string>;
  get(storageRef: string): Promise<Uint8Array>;
}

const KEY_RE = /^[0-9a-f-]{36}\/[0-9a-f]{64}\.pdf$/;

export function documentKey(userId: string, sha256: string, ext: "pdf"): string {
  const key = `${userId.toLowerCase()}/${sha256}.${ext}`;
  if (!KEY_RE.test(key)) throw new Error("invalid document key");
  return key;
}

function checkKey(key: string): string {
  if (!KEY_RE.test(key)) throw new Error("invalid document key");
  return key;
}

// Dev-only local storage: the turbopackIgnore hints keep the build from tracing the whole project.
export function createLocalDocumentStorage(dir?: string): DocumentStorage {
  const root = resolve(/*turbopackIgnore: true*/ dir ?? join(process.cwd(), ".data", "documents"));
  const pathFor = (key: string) => {
    const p = resolve(/*turbopackIgnore: true*/ root, checkKey(key));
    if (!p.startsWith(root + sep)) throw new Error("invalid document key");
    return p;
  };
  return {
    async put(key, bytes) {
      const p = pathFor(key);
      await mkdir(resolve(/*turbopackIgnore: true*/ p, ".."), { recursive: true, mode: 0o700 });
      await writeFile(p, bytes, { mode: 0o600 });
      return `local:${key}`;
    },
    async get(ref) {
      if (!ref.startsWith("local:")) throw new Error("not a local storage ref");
      return new Uint8Array(await readFile(pathFor(ref.slice("local:".length))));
    },
  };
}

/**
 * Supabase Storage over its REST API with the user's own access token (RLS on storage.objects),
 * never service_role. The bucket must be private.
 */
export function createSupabaseDocumentStorage(opts: {
  url: string;
  anonKey: string;
  accessToken: string;
  bucket: string;
  fetchImpl?: typeof fetch;
}): DocumentStorage {
  const doFetch = opts.fetchImpl ?? fetch;
  const headers = { apikey: opts.anonKey, authorization: `Bearer ${opts.accessToken}` };
  return {
    async put(key, bytes, contentType) {
      const url = new URL(`/storage/v1/object/${opts.bucket}/${checkKey(key)}`, opts.url);
      const res = await doFetch(url, {
        method: "POST",
        headers: { ...headers, "content-type": contentType, "x-upsert": "false" },
        body: bytes as BodyInit,
      });
      // Same user + same hash = same content: an existing object is fine.
      if (!res.ok && res.status !== 409) {
        const body = await res.text().catch(() => "");
        if (!/duplicate|already exists/i.test(body)) throw new Error(`storage upload failed: ${res.status}`);
      }
      return `supabase:${opts.bucket}/${key}`;
    },
    async get(ref) {
      const prefix = `supabase:${opts.bucket}/`;
      if (!ref.startsWith(prefix)) throw new Error("not a supabase storage ref for this bucket");
      const url = new URL(`/storage/v1/object/authenticated/${opts.bucket}/${checkKey(ref.slice(prefix.length))}`, opts.url);
      const res = await doFetch(url, { headers });
      if (!res.ok) throw new Error(`storage download failed: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

/**
 * Pick storage for an upload from the environment. Supabase when URL, anon key and a user access
 * token are available; local disk otherwise, but never in production.
 */
export function getDocumentStorage(accessToken?: string): DocumentStorage {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && anonKey && accessToken) {
    return createSupabaseDocumentStorage({
      url,
      anonKey,
      accessToken,
      bucket: process.env.REINS_DOCUMENTS_BUCKET || "documents",
    });
  }
  if (process.env.NODE_ENV === "production") throw new Error("document storage is not configured");
  return createLocalDocumentStorage();
}

/** A stored document cannot be read by a server-side job. Fails that document only. */
export class DocumentStorageUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentStorageUnavailable";
  }
}

/** JWT payload `role` claim, or null when the token is not a decodable JWT. */
function jwtRole(token: string): string | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as { role?: unknown };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

export type ServerStorageEnv = Partial<
  Record<"NODE_ENV" | "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_ANON_KEY" | "REINS_STORAGE_READ_TOKEN", string>
>;

/**
 * Read-only storage for server-side jobs (the Reader), which run without a user token. The
 * backend is chosen per load from the storage_ref prefix, so a document is always read from
 * where it was written:
 *   local:    the dev directory (refused in production)
 *   supabase: Supabase Storage with REINS_STORAGE_READ_TOKEN, a JWT for a read-only storage
 *             role. Never service_role: such a token is refused.
 * Nothing is resolved at construction time; a missing backend fails only the document that
 * needs it, with DocumentStorageUnavailable.
 */
export function createServerDocumentStorage(
  opts: { env?: ServerStorageEnv; localDir?: string; fetchImpl?: typeof fetch } = {},
): Pick<DocumentStorage, "get"> {
  const env = (opts.env ?? process.env) as ServerStorageEnv;
  return {
    async get(ref) {
      if (ref.startsWith("local:")) {
        if (env.NODE_ENV === "production") throw new DocumentStorageUnavailable("local document storage is not available in production");
        return createLocalDocumentStorage(opts.localDir).get(ref);
      }
      const m = /^supabase:([^/]+)\//.exec(ref);
      if (m) {
        const url = env.NEXT_PUBLIC_SUPABASE_URL;
        const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        const token = env.REINS_STORAGE_READ_TOKEN;
        if (!url || !anonKey || !token) {
          throw new DocumentStorageUnavailable(
            "server-side Supabase storage reads are not configured (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, REINS_STORAGE_READ_TOKEN)",
          );
        }
        const role = jwtRole(token);
        if (!role || role === "service_role") {
          throw new DocumentStorageUnavailable("REINS_STORAGE_READ_TOKEN must be a JWT for a read-only storage role, never service_role");
        }
        return createSupabaseDocumentStorage({ url, anonKey, accessToken: token, bucket: m[1], fetchImpl: opts.fetchImpl }).get(ref);
      }
      throw new DocumentStorageUnavailable("unknown document storage ref");
    },
  };
}
