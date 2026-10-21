// Owner: R3 (roles.md).
// GET /api/audit/transactions[?format=csv] : the signed-in user's on-chain transactions with
// Basescan links (architecture §17, task R3-14). JSON by default, CSV as a download.

import { connection } from "next/server";
import { getSessionUserId } from "@/src/server/auth/session";
import { jsonError } from "@/src/server/db/read/http";
import { chainTransactionsCsv, listChainTransactions } from "@/src/server/platform/chain-transactions";

export async function GET(req: Request): Promise<Response> {
  await connection();
  const userId = await getSessionUserId(req);
  if (!userId) return jsonError(401, "unauthorized");
  const format = new URL(req.url).searchParams.get("format");
  if (format !== null && format !== "csv") return jsonError(400, "format must be csv or omitted", "bad_format");
  try {
    const rows = await listChainTransactions(userId);
    if (format === "csv") {
      return new Response(chainTransactionsCsv(rows), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": "attachment; filename=reins-chain-transactions.csv",
          "cache-control": "no-store",
        },
      });
    }
    return Response.json({ transactions: rows }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[audit-transactions]", (e as Error).message);
    return jsonError(500, "internal_error");
  }
}
