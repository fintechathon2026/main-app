import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentRepo, DocumentRow } from "@/src/server/ingest/repo";
import { createLocalDocumentStorage, documentKey } from "@/src/server/ingest/storage";
import {
  MAX_UPLOAD_BYTES,
  UploadRejected,
  createDocumentLoader,
  ingestUpload,
  sha256Hex,
  sniffPdf,
} from "@/src/server/ingest/upload";
import { accessTokenFromCookies, getSessionUserId } from "@/src/server/auth/session";
import { createDocumentReader } from "@/src/agent/nodes/reader";
import { FakeModelClient, fixtureBytes } from "./helpers";

const USER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const pdf = fixtureBytes("fixtures/documents/sz_power_bill_2026_09.pdf");

/** In-memory stand-in for the documents table with unique (user_id, sha256). */
function memoryRepo(): DocumentRepo & { rows: DocumentRow[] } {
  const rows: DocumentRow[] = [];
  return {
    rows,
    async findByHash(userId, sha256) {
      return rows.find((r) => r.userId === userId && r.sha256 === sha256)?.id ?? null;
    },
    async insertIdempotent(input) {
      const hit = rows.find((r) => r.userId === input.userId && r.sha256 === input.sha256);
      if (hit) return { id: hit.id, created: false };
      const id = `doc-${rows.length + 1}`;
      rows.push({ id, userId: input.userId, type: input.type, storageRef: input.storageRef, sha256: input.sha256 });
      return { id, created: true };
    },
    async get(documentId, userId) {
      return rows.find((r) => r.id === documentId && r.userId === userId) ?? null;
    },
    async setStatus() {},
  };
}

const dirs: string[] = [];
const tmpStorage = () => {
  const d = mkdtempSync(join(tmpdir(), "reins-docs-"));
  dirs.push(d);
  return createLocalDocumentStorage(d);
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("ingestUpload", () => {
  it("sniffs PDF magic bytes", () => {
    expect(sniffPdf(pdf)).toBe(true);
    expect(sniffPdf(new TextEncoder().encode("<html>%PDF-</html>"))).toBe(false);
    expect(sniffPdf(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });

  it("stores bytes, inserts a row, and calls onDocument once", async () => {
    const repo = memoryRepo();
    const storage = tmpStorage();
    const onDocument = vi.fn();
    const r = await ingestUpload({ userId: USER, bytes: pdf }, { repo, storage, onDocument });
    expect(r).toMatchObject({ created: true, queued: true, sha256: sha256Hex(pdf) });
    expect(onDocument).toHaveBeenCalledWith(r.documentId, USER);
    expect(repo.rows[0].storageRef).toBe(`local:${documentKey(USER, r.sha256, "pdf")}`);
    expect(await storage.get(repo.rows[0].storageRef)).toEqual(pdf);
  });

  it("is idempotent per user and content hash", async () => {
    const repo = memoryRepo();
    const storage = tmpStorage();
    const onDocument = vi.fn();
    const a = await ingestUpload({ userId: USER, bytes: pdf }, { repo, storage, onDocument });
    const b = await ingestUpload({ userId: USER, bytes: pdf }, { repo, storage, onDocument });
    const c = await ingestUpload({ userId: OTHER, bytes: pdf }, { repo, storage, onDocument });
    expect(b).toMatchObject({ documentId: a.documentId, created: false, queued: false });
    expect(c.documentId).not.toBe(a.documentId);
    expect(onDocument).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["empty", new Uint8Array(), "empty", 400],
    ["not a PDF", new TextEncoder().encode("hello"), "not_pdf", 415],
    ["too large", (() => { const b = new Uint8Array(MAX_UPLOAD_BYTES + 1); b.set(pdf.subarray(0, 8)); return b; })(), "too_large", 413],
  ])("rejects %s", async (_n, bytes, code, status) => {
    const repo = memoryRepo();
    const err = await ingestUpload({ userId: USER, bytes }, { repo, storage: tmpStorage() }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UploadRejected);
    expect(err).toMatchObject({ code, status });
    expect(repo.rows).toHaveLength(0);
  });

  it("keeps the document when onDocument fails", async () => {
    const repo = memoryRepo();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await ingestUpload(
      { userId: USER, bytes: pdf },
      { repo, storage: tmpStorage(), onDocument: () => Promise.reject(new Error("queue down")) },
    );
    expect(r).toMatchObject({ created: true, queued: false });
    spy.mockRestore();
  });

  it("feeds the Reader through the loader, scoped to the owner", async () => {
    const repo = memoryRepo();
    const storage = tmpStorage();
    const { documentId } = await ingestUpload({ userId: USER, bytes: pdf }, { repo, storage });
    const loadDocument = createDocumentLoader({ repo, storage });
    const model = new FakeModelClient(() => ({
      biller_name: "SZ_POWER",
      amount: 386.5,
      currency: "CNY",
      due_date: "2026-10-25",
      period: "2026-09",
      suspicious_text: false,
    }));
    const fields = await createDocumentReader({ models: { reader: model }, loadDocument }).read(documentId, USER);
    expect(fields.every((f) => f.origin === "document" && f.sourceId === documentId)).toBe(true);
    await expect(loadDocument(documentId, OTHER)).rejects.toThrow(/not found/);
  });

  it("local storage refuses path traversal keys", async () => {
    const storage = tmpStorage();
    await expect(storage.put("../../etc/passwd", pdf, "application/pdf")).rejects.toThrow(/invalid document key/);
    await expect(storage.get("local:../x.pdf")).rejects.toThrow(/invalid document key/);
  });
});

describe("session", () => {
  const env = { ...process.env };
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });
  afterEach(() => {
    process.env = { ...env };
  });

  const req = (headers: Record<string, string>) => new Request("http://localhost/api/ingest/upload", { headers });

  it("accepts x-demo-user only with REINS_DEMO_AUTH=1 outside production", async () => {
    expect(await getSessionUserId(req({ "x-demo-user": USER }))).toBeNull();
    process.env.REINS_DEMO_AUTH = "1";
    expect(await getSessionUserId(req({ "x-demo-user": USER }))).toBe(USER);
    expect(await getSessionUserId(req({ "x-demo-user": "not-a-uuid" }))).toBeNull();
    vi.stubEnv("NODE_ENV", "production");
    expect(await getSessionUserId(req({ "x-demo-user": USER }))).toBeNull();
    vi.unstubAllEnvs();
  });

  it("reads chunked base64 Supabase auth cookies", () => {
    const value = `base64-${Buffer.from(JSON.stringify({ access_token: "tok-123" })).toString("base64url")}`;
    const half = Math.floor(value.length / 2);
    const cookie = `other=1; sb-abc-auth-token.0=${value.slice(0, half)}; sb-abc-auth-token.1=${value.slice(half)}`;
    expect(accessTokenFromCookies(cookie)).toBe("tok-123");
    expect(accessTokenFromCookies("sb-abc-auth-token=garbage")).toBeNull();
  });
});

describe("POST /api/ingest/upload", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    vi.resetModules();
    vi.doUnmock("@/src/server/ingest/repo");
    vi.doUnmock("@/src/server/ingest/storage");
  });

  async function loadRoute() {
    const repo = memoryRepo();
    const storage = tmpStorage();
    vi.doMock("@/src/server/ingest/repo", () => ({ createPgDocumentRepo: () => repo }));
    vi.doMock("@/src/server/ingest/storage", async (orig) => ({
      ...(await orig<typeof import("@/src/server/ingest/storage")>()),
      getDocumentStorage: () => storage,
    }));
    const mod = await import("@/app/api/ingest/upload/route");
    return { POST: mod.POST, repo };
  }

  const upload = (bytes: Uint8Array, headers: Record<string, string> = {}) => {
    const form = new FormData();
    form.set("file", new File([bytes as BlobPart], "bill.pdf", { type: "application/pdf" }));
    return new Request("http://localhost/api/ingest/upload", { method: "POST", body: form, headers });
  };

  it("401 without a session", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.REINS_DEMO_AUTH;
    const { POST, repo } = await loadRoute();
    expect((await POST(upload(pdf))).status).toBe(401);
    expect(repo.rows).toHaveLength(0);
  });

  it("201 then 200 for the same file, 415 for a non-PDF", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.REINS_DEMO_AUTH = "1";
    const { POST, repo } = await loadRoute();
    const first = await POST(upload(pdf, { "x-demo-user": USER }));
    expect(first.status).toBe(201);
    const body = (await first.json()) as { documentId: string; created: boolean };
    expect(body.created).toBe(true);
    const second = await POST(upload(pdf, { "x-demo-user": USER }));
    expect(second.status).toBe(200);
    expect(((await second.json()) as { documentId: string }).documentId).toBe(body.documentId);
    const html = await POST(upload(new TextEncoder().encode("<html></html>"), { "x-demo-user": USER }));
    expect(html.status).toBe(415);
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0].userId).toBe(USER);
  });
});
