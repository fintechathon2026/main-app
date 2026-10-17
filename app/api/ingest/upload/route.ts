// POST /api/ingest/upload: bill PDF upload (architecture §13, §16.2).
// multipart/form-data with one `file` field. userId comes from the session, never the body.
// No `runtime` export: with cacheComponents on, Next.js 16 requires the default Node.js runtime
// and rejects the `runtime` segment config (node_modules/next/dist/docs, runtime.md).

import { getSession } from "@/src/server/auth/session";
import { onDocumentUploaded } from "@/src/server/ingest/on-document";
import { createPgDocumentRepo } from "@/src/server/ingest/repo";
import { getDocumentStorage } from "@/src/server/ingest/storage";
import { MAX_UPLOAD_BYTES, UploadRejected, ingestUpload } from "@/src/server/ingest/upload";

type UploadResponse = { documentId: string; created: boolean; queued: boolean };
type ErrorResponse = { error: string };

const MULTIPART_OVERHEAD = 64 * 1024;

const json = (body: UploadResponse | ErrorResponse, status: number) => Response.json(body, { status });

export async function POST(request: Request): Promise<Response> {
  const session = await getSession(request);
  if (!session) return json({ error: "unauthorized" }, 401);

  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD) return json({ error: "too_large" }, 413);
  if (!(request.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
    return json({ error: "expected multipart/form-data" }, 415);
  }

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return json({ error: "invalid form data" }, 400);
  }
  if (!(file instanceof File)) return json({ error: "missing file" }, 400);
  if (file.size > MAX_UPLOAD_BYTES) return json({ error: "too_large" }, 413);

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await ingestUpload(
      { userId: session.userId, bytes },
      { storage: getDocumentStorage(session.accessToken), repo: createPgDocumentRepo(), onDocument: onDocumentUploaded },
    );
    return json({ documentId: result.documentId, created: result.created, queued: result.queued }, result.created ? 201 : 200);
  } catch (e) {
    if (e instanceof UploadRejected) return json({ error: e.code }, e.status);
    console.error("ingest/upload failed", { error: e instanceof Error ? e.name : "unknown" });
    return json({ error: "internal" }, 500);
  }
}
