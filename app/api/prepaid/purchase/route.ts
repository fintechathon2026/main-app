// Owner: R2 (roles.md). POST /api/prepaid/purchase (architecture §13, §24.10): the user's signed
// purchase {offerId, offer, merchantSig, auth, consumerSig, permit?}. Runs as a user action through
// the executor: the Gate re-verifies both signatures and the mandate's prepaid rules before the
// escrow is called. Reins never buys on its own (prepaid.agent_cannot_purchase).

import { getSessionUserId } from "@/src/server/auth/session";
import { PurchaseBody, purchase } from "@/src/server/prepaid/user-actions";
import { actionResult, err, userActionError } from "../_lib";

export async function POST(request: Request): Promise<Response> {
  const userId = await getSessionUserId(request);
  if (!userId) return err(401, "unauthorized");
  const body = PurchaseBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return err(400, "invalid body", "bad_request");
  try {
    return actionResult(await purchase(userId, body.data));
  } catch (e) {
    return userActionError(e, "prepaid purchase");
  }
}
