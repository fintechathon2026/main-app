// Owner: R3 (roles.md). GET /api/audit/export?format=jsonl|csv (architecture §13, §17).

import { connection } from "next/server";
import { getSessionUserId } from "@/src/server/auth/session";
import { jsonError } from "@/src/server/db/read/http";
import { listAuditRows, toCsv, toJsonl } from "@/src/server/audit/export";

export async function GET(request: Request): Promise<Response> {
  await connection();
  const userId = await getSessionUserId(request);
  if (!userId) return jsonError(401, "unauthorized");
  const format = new URL(request.url).searchParams.get("format") ?? "jsonl";
  if (format !== "jsonl" && format !== "csv") return jsonError(400, "format must be jsonl or csv", "bad_format");
  try {
    const rows = await listAuditRows(userId);
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
