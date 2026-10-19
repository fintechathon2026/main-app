// Owner: R3 (roles.md).
// POST /sim/merchant/checkin {planId} : the gym's Redeem signature for the plan's next session
// (architecture §24.7). The consumer's co-signature is collected separately.
// No `runtime` export: cacheComponents is on, and Node is the default runtime.
import { handleCheckin } from "@/src/sim/merchant/http";

export async function POST(req: Request): Promise<Response> {
  return handleCheckin(req);
}
