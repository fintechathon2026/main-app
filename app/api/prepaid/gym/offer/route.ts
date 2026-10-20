// Owner: R3 (roles.md). GET /api/prepaid/gym/offer?offerId= : the gym's signed offer for a listed
// offer, fetched from the merchant simulator server side (SIM_API_KEY stays on the server).

import { connection } from "next/server";
import { getSessionUserId, isUuid } from "@/src/server/auth/session";
import { withUserTx } from "@/src/server/db/pool";
import { GymError, gymOffer } from "@/src/server/prepaid/gym-client";
import { err, noStore } from "../../_lib";

export async function GET(request: Request): Promise<Response> {
  await connection();
  const userId = await getSessionUserId(request);
  if (!userId) return err(401, "unauthorized");
  const offerId = new URL(request.url).searchParams.get("offerId") ?? "";
  if (!isUuid(offerId)) return err(404, "not found", "not_found");
  const merchantId = await withUserTx(userId, async (tx) => {
    const r = await tx.query("select merchant_id from public.prepaid_offers where id = $1", [offerId]);
    return r.rows[0]?.merchant_id as string | undefined;
  });
  if (!merchantId) return err(404, "not found", "not_found");
  try {
    const o = await gymOffer(merchantId);
    return o ? Response.json(o, { headers: noStore }) : err(404, "the gym has no signed offer", "no_signed_offer");
  } catch (e) {
    return err(502, "gym unavailable", e instanceof GymError ? `gym_${e.status}` : "gym_unavailable");
  }
}
