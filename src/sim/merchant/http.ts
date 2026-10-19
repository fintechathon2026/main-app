// Owner: R3 (roles.md).
// HTTP handlers for the merchant simulator (architecture §24.7). Routes under app/sim/merchant
// are thin wrappers around these. Same SIM_API_KEY rules as the registry simulator.

import { z } from "zod";
import { simAdminOk, simReadOk } from "../auth";
import { chainConfigFromEnv, publicClientFor, readChainPlan } from "@/src/server/chain/client";
import { CheckinRefused, MerchantKeyMissing, currentOffers, signCheckin } from "./merchant";

const noStore = { "cache-control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: noStore });

/** GET /sim/merchant/offers */
export async function handleOffers(req: Request): Promise<Response> {
  if (!simReadOk(req)) return json({ error: "unauthorized" }, 401);
  try {
    return json({ simulated: true, offers: await currentOffers() });
  } catch (e) {
    if (e instanceof MerchantKeyMissing) return json({ error: "merchant key not configured" }, 503);
    throw e;
  }
}

const CheckinBody = z.object({ planId: z.union([z.string().regex(/^\d{1,30}$/), z.number().int().positive()]) }).strict();

/**
 * POST /sim/merchant/checkin {planId}: the gym tablet signs the next session. Admin key: in the
 * demo the gym's staff press the button, not the customer.
 */
export async function handleCheckin(req: Request): Promise<Response> {
  if (!simAdminOk(req)) return json({ error: "unauthorized" }, 401);
  let body: z.infer<typeof CheckinBody>;
  try {
    body = CheckinBody.parse(await req.json());
  } catch {
    return json({ error: "invalid body" }, 400);
  }
  const chain = chainConfigFromEnv();
  if (!chain) return json({ error: "chain not configured" }, 503);
  const client = publicClientFor(chain);
  try {
    const checkin = await signCheckin({
      planId: BigInt(body.planId),
      readPlan: async (id) => {
        const p = await readChainPlan(client, chain.escrowAddress, id);
        return p && { merchant: p.merchant, status: p.status, units: p.units, redeemed: p.redeemed };
      },
    });
    return json(checkin, 201);
  } catch (e) {
    if (e instanceof MerchantKeyMissing) return json({ error: "merchant key not configured" }, 503);
    if (e instanceof CheckinRefused) return json({ error: e.message }, 409);
    throw e;
  }
}
