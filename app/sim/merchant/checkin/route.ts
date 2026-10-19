// POST /sim/merchant/checkin {planId} : the gym tablet signs the next session with the merchant
// key (architecture §24.7). Bearer SIM_API_KEY.
// No `runtime` export: cacheComponents is on, and Node is the default runtime.

import { handleCheckin } from "@/src/sim/merchant/http";

export async function POST(req: Request): Promise<Response> {
  return handleCheckin(req);
}
