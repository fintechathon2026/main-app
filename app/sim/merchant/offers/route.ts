// Owner: R3 (roles.md).
// GET /sim/merchant/offers : offers signed with the merchant simulator key (architecture §24.7).
// No `runtime` export: cacheComponents is on, and Node is the default runtime.
import { handleOffers } from "@/src/sim/merchant/http";

export async function GET(req: Request): Promise<Response> {
  return handleOffers(req);
}
