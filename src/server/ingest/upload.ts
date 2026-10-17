// Bill PDF ingestion (architecture §10, §14.2, §16.2). Validates size and magic bytes, hashes
// the content, stores the bytes, inserts the `documents` row idempotently, then hands the id to
// `onDocument` (the Reader run is wired at integration). The PDF is never parsed or rendered
// here: only the Reader path parses it.

import { createHash } from "node:crypto";
import { isUuid } from "@/src/server/auth/session";
import type { DocumentRepo, DocumentRow } from "./repo";
import { documentKey, type DocumentStorage } from "./storage";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_RETENTION_DAYS = 30; // PRD §17.1: raw documents deleted after 30 days

export type UploadRejectCode = "empty" | "too_large" | "not_pdf" | "bad_user";

export class UploadRejected extends Error {
  readonly code: UploadRejectCode;
  readonly status: number;
  constructor(code: UploadRejectCode) {
    super(`upload rejected: ${code}`);
    this.name = "UploadRejected";
    this.code = code;
    this.status = code === "too_large" ? 413 : code === "not_pdf" ? 415 : 400;
  }
}

/** PDF magic bytes: "%PDF-" at offset 0 (optionally after a UTF-8 BOM). */
export function sniffPdf(bytes: Uint8Array): boolean {
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  const magic = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
  return magic.every((b, i) => bytes[start + i] === b);
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export type OnDocument = (documentId: string, userId: string) => Promise<void> | void;

export type IngestDeps = {
  storage: DocumentStorage;
  repo: DocumentRepo;
  onDocument?: OnDocument;
  now?: () => Date;
};

export type IngestResult = {
  documentId: string;
  sha256: string;
  /** false when the same user already uploaded identical bytes. */
  created: boolean;
  /** true when onDocument ran without error for a newly created document. */
  queued: boolean;
};

export async function ingestUpload(input: { userId: string; bytes: Uint8Array }, deps: IngestDeps): Promise<IngestResult> {
  const { userId, bytes } = input;
  if (!isUuid(userId)) throw new UploadRejected("bad_user");
  if (bytes.byteLength === 0) throw new UploadRejected("empty");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new UploadRejected("too_large");
  if (!sniffPdf(bytes)) throw new UploadRejected("not_pdf");

  const sha256 = sha256Hex(bytes);
  const existing = await deps.repo.findByHash(userId, sha256);
  if (existing) return { documentId: existing, sha256, created: false, queued: false };

  const storageRef = await deps.storage.put(documentKey(userId, sha256, "pdf"), bytes, "application/pdf");
  const receivedAt = (deps.now ?? (() => new Date()))();
  const retentionUntil = new Date(receivedAt.getTime() + DOCUMENT_RETENTION_DAYS * 86_400_000);
  const { id, created } = await deps.repo.insertIdempotent({
    userId,
    type: "bill_pdf",
    storageRef,
    sha256,
    receivedAt,
    retentionUntil,
  });

  let queued = false;
  if (created && deps.onDocument) {
    try {
      await deps.onDocument(id, userId);
      queued = true;
    } catch (e) {
      // The document is stored; a later sweep can pick it up. Log the id only, never content.
      console.error("ingest: onDocument failed", { documentId: id, error: e instanceof Error ? e.name : "unknown" });
    }
  }
  return { documentId: id, sha256, created, queued };
}

/** Loader for the Reader (`ReaderDeps.loadDocument`): user-scoped row, then the stored bytes. */
export function createDocumentLoader(deps: { repo: DocumentRepo; storage: Pick<DocumentStorage, "get"> }) {
  return async (documentId: string, userId: string): Promise<{ bytes: Uint8Array; mimeType: string }> => {
    const row: DocumentRow | null = await deps.repo.get(documentId, userId);
    if (!row) throw new Error("document not found");
    const bytes = await deps.storage.get(row.storageRef);
    if (sha256Hex(bytes) !== row.sha256) throw new Error("document content hash mismatch");
    return { bytes, mimeType: row.type === "bill_pdf" ? "application/pdf" : "application/octet-stream" };
  };
}
