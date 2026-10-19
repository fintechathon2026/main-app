// Owner: R3 (roles.md).
// GET /api/audit/export?format=jsonl|csv (default jsonl): the signed-in user's own audit log as a
// file download (PRD FR10.4). Session-scoped; never another user's entries.

import { connection } from "next/server";
import fixture from "@/fixtures/api/audit-export.json";
import type { AuditExportEntry } from "@/src/server/api-types";
import { getSessionUserId } from "@/src/server/auth/session";
import { fixturesEnabled, jsonError } from "@/src/server/db/read/http";
import { type AuditExportFormat, exportAudit, serializeAudit } from "@/src/server/platform/audit-export";

const CONTENT_TYPE: Record<AuditExportFormat, string> = {
  jsonl: "application/x-ndjson; charset=utf-8",
  csv: "text/csv; charset=utf-8",
};

const file = (text: string, format: AuditExportFormat) =>
  new Response(text, {
    headers: {
      "content-type": CONTENT_TYPE[format],
      "content-disposition": `attachment; filename=reins-audit.${format}`,
      "cache-control": "no-store",
    },
  });

export async function GET(req: Request): Promise<Response> {
  await connection();
  const format = new URL(req.url).searchParams.get("format") ?? "jsonl";
  const badFormat = () => jsonError(400, "format must be jsonl or csv", "bad_format");
  if (fixturesEnabled()) {
    if (format !== "jsonl" && format !== "csv") return badFormat();
    return file(serializeAudit(fixture as AuditExportEntry[], format), format);
  }
  const userId = await getSessionUserId(req);
  if (!userId) return jsonError(401, "unauthorized");
  if (format !== "jsonl" && format !== "csv") return badFormat();
  try {
    return file(await exportAudit(userId, format), format);
  } catch (e) {
    console.error("[audit-export]", (e as Error).message);
    return jsonError(500, "internal_error");
  }
}
