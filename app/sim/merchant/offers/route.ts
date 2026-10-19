// GET /sim/merchant/offers : signed package offers from the merchant simulator (architecture
// §24.7). Bearer SIM_API_KEY when configured.
// No `runtime` export: cacheComponents is on, and Node is the default runtime.

import { connection } from "next/server";
import { handleOffers } from "@/src/sim/merchant/http";

export async function GET(req: Request): Promise<Response> {
  await connection();
  return handleOffers(req);
}
