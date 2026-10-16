// Server-side document storage for the Reader job (src/server/ingest/storage.ts): the backend is
// picked per load from the storage_ref prefix, and wiring never resolves storage eagerly.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  DocumentStorageUnavailable,
  createLocalDocumentStorage,
  createServerDocumentStorage,
  documentKey,
} from "@/src/server/ingest/storage";

const USER = "22222222-2222-4222-8222-222222222222";
const KEY = documentKey(USER, "a".repeat(64), "pdf");
const BYTES = new TextEncoder().encode("%PDF-1.4 test");

const jwt = (payload: Record<string, unknown>) =>
  `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "reins-server-storage-"));
  dirs.push(d);
  return d;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const SUPA = { NEXT_PUBLIC_SUPABASE_URL: "http://supabase.test", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" };

describe("createServerDocumentStorage", () => {
  it("reads local: refs from the local directory in development", async () => {
    const dir = tmp();
    const ref = await createLocalDocumentStorage(dir).put(KEY, BYTES, "application/pdf");
    const storage = createServerDocumentStorage({ env: { NODE_ENV: "development", ...SUPA }, localDir: dir });
    expect(await storage.get(ref)).toEqual(BYTES);
  });

  it("reads supabase: refs from Supabase with the server read token, even when local storage exists", async () => {
    const token = jwt({ role: "reins_storage_reader" });
    const fetchImpl = vi.fn<(url: URL, init?: RequestInit) => Promise<Response>>(async () => new Response(BYTES));
    const storage = createServerDocumentStorage({
      env: { NODE_ENV: "development", ...SUPA, REINS_STORAGE_READ_TOKEN: token },
      localDir: tmp(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await storage.get(`supabase:documents/${KEY}`)).toEqual(BYTES);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe(`http://supabase.test/storage/v1/object/authenticated/documents/${KEY}`);
    expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${token}`);
  });

  it("fails only the document when Supabase reads are not configured", async () => {
    const storage = createServerDocumentStorage({ env: { NODE_ENV: "production", ...SUPA } });
    await expect(storage.get(`supabase:documents/${KEY}`)).rejects.toBeInstanceOf(DocumentStorageUnavailable);
  });

  it("refuses a service_role token", async () => {
    const fetchImpl = vi.fn();
    const storage = createServerDocumentStorage({
      env: { ...SUPA, REINS_STORAGE_READ_TOKEN: jwt({ role: "service_role" }) },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(storage.get(`supabase:documents/${KEY}`)).rejects.toThrow(/never service_role/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses local refs in production", async () => {
    const storage = createServerDocumentStorage({ env: { NODE_ENV: "production" }, localDir: tmp() });
    await expect(storage.get(`local:${KEY}`)).rejects.toBeInstanceOf(DocumentStorageUnavailable);
  });
});

describe("getAgentDeps", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    vi.resetModules();
  });

  it("builds in production without any storage configuration", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.REINS_MODELS = "recorded";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.REINS_STORAGE_READ_TOKEN;
    const { getAgentDeps } = await import("@/src/agent/wiring");
    expect(() => getAgentDeps()).not.toThrow();
    vi.unstubAllEnvs();
  });
});
