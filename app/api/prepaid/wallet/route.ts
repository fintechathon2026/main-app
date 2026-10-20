// Owner: R2 (roles.md). POST /api/prepaid/wallet {address} (architecture §13, §24.2): registers
// the browser-generated consumer address. Address only: the key never reaches the server.

import { z } from "zod";
import { getSessionUserId } from "@/src/server/auth/session";
import { registerWallet } from "@/src/server/prepaid/user-actions";
import { err, noStore, userActionError } from "../_lib";

const Body = z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) }).strict();

export async function POST(request: Request): Promise<Response> {
  const userId = await getSessionUserId(request);
  if (!userId) return err(401, "unauthorized");
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return err(400, "invalid body", "bad_request");
  }
  try {
    return Response.json(await registerWallet(userId, body.address), { headers: noStore });
  } catch (e) {
    return userActionError(e, "wallet register");
  }
}
