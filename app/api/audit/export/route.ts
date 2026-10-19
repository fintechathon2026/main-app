// Owner: R3 (roles.md). GET /api/audit/export?format=jsonl|csv (architecture §13, §17).

import { connection } from "next/server";
import fixture from "@/fixtures/api/feed-why.json";
import { getSessionUserId } from "@/src/server/auth/session";
import { fixturesEnabled, jsonError } from "@/src/server/db/read/http";
import { listAuditRows, toCsv, toJsonl, type AuditExportRow } from "@/src/server/audit/export";

// Fixture mode: the synthetic audit rows from the "Why?" fixture, so the export can be shown.
const fixtureRows = (): AuditExportRow[] => fixture.audit.map((a) => ({ seq: a.seq, createdAt: a.createdAt, actor: a.actor, eventType: a.eventType, prevHash: a.prevHash, hash: a.hash, event: { simulated: true } }));

export async function GET(request: Request): Promise<Response> {
  await connection();
  const fixtures = fixturesEnabled();
  const userId = fixtures ? null : await getSessionUserId(request);
  if (!fixtures && !userId) return jsonError(401, "unauthorized");
  const format = new URL(request.url).searchParams.get("format") ?? "jsonl";
  if (format !== "jsonl" && format !== "csv") return jsonError(400, "format must be jsonl or csv", "bad_format");
  try {
    const rows = userId ? await listAuditRows(userId) : fixtureRows();
    const body = format === "csv" ? toCsv(rows) : toJsonl(rows);
    return new Response(body, {
      headers: {
        "content-type": format === "csv" ? "text/csv; charset=utf-8" : "application/x-ndjson; charset=utf-8",
        "content-disposition": `attachment; filename="reins-audit.${format}"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    console.error(JSON.stringify({ msg: "audit export failed", error: e instanceof Error ? e.message : String(e) }));
    return jsonError(500, "internal");
  }
}
