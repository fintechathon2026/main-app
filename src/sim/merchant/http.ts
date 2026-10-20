// Owner: R3 (roles.md).
// HTTP handlers for the merchant simulator (architecture §24.7). Routes under app/sim/merchant
// are thin wrappers around these.
import { z } from "zod";
import { simReadOk } from "../auth";
import { CheckinError, defaultPlanReader, signCheckin, type PlanReader } from "./checkin";
import { MerchantKeyMissing } from "./keys";
import { listOffers } from "./offers";

const noStore = { "cache-control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: noStore });
const keyMissing = () => json({ error: "merchant key not configured" }, 503);

/** GET /sim/merchant/offers */
export async function handleOffers(req: Request): Promise<Response> {
  if (!simReadOk(req)) return json({ error: "unauthorized" }, 401);
  try {
    return json({ simulated: true, offers: await listOffers() });
  } catch (e) {
    if (e instanceof MerchantKeyMissing) return keyMissing();
    throw e;
  }
}

const CheckinBody = z.object({ planId: z.string().regex(/^\d{1,78}$/) }).strict();

/** POST /sim/merchant/checkin {planId}: the gym's signature over Redeem for the next session. */
export async function handleCheckin(req: Request, readPlan: PlanReader = defaultPlanReader()): Promise<Response> {
  if (!simReadOk(req)) return json({ error: "unauthorized" }, 401);
  let body: z.infer<typeof CheckinBody>;
  try {
    body = CheckinBody.parse(await req.json());
  } catch {
    return json({ error: "invalid body" }, 400);
  }
  try {
    return json(await signCheckin(body.planId, new Date(), readPlan));
  } catch (e) {
    if (e instanceof MerchantKeyMissing) return keyMissing();
    if (e instanceof CheckinError) return json({ error: e.code }, e.status);
    throw e;
  }
}
