// Owner: R2 (roles.md).
// GET /api/audit/verify (architecture §13): walks the signed-in user's whole hash chain
// (verifyAuditChain) and returns the result with the newest entries as plain-language rows for
// the Evidence screen. Session-scoped. REINS_FIXTURES=1 serves fixtures/api/audit-verify.json.
// No `runtime` export: cacheComponents is on, and Node is the default runtime.

import fixture from "@/fixtures/api/audit-verify.json";
import type { AuditVerifyResponse } from "@/src/server/api-types";
import { loadAuditVerify } from "@/src/server/db/read/audit-repo";
import { readRoute } from "@/src/server/db/read/http";

export async function GET(req: Request): Promise<Response> {
  return readRoute<AuditVerifyResponse>(
    req,
    () => fixture as AuditVerifyResponse,
    (d) => loadAuditVerify(d.userId, d.now),
  );
}
