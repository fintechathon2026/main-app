"use server";

// Server action for the gym tablet page: signs the next session for a plan with the merchant
// simulator key (src/sim/merchant). Simulator only: the key never leaves the server, and the
// signature alone moves nothing (the member must co-sign, and the escrow verifies both).

import { CheckinError, signCheckin } from "@/src/sim/merchant/checkin";
import { MerchantKeyMissing } from "@/src/sim/merchant/keys";

export type TabletResult = { ok: true; planId: string; sessionNo: number; deadline: number } | { ok: false; error: string };

export async function signNextSession(planId: string): Promise<TabletResult> {
  if (process.env.NODE_ENV === "production" && process.env.REINS_DEMO_TABLET !== "1") return { ok: false, error: "The demo tablet is off." };
  if (!/^\d{1,30}$/.test(planId)) return { ok: false, error: "Enter the plan number from the member's app." };
  try {
    const c = await signCheckin(planId);
    return { ok: true, planId: c.planId, sessionNo: c.sessionNo, deadline: c.deadline };
  } catch (e) {
    if (e instanceof MerchantKeyMissing) return { ok: false, error: "The gym key is not configured (MERCHANT_SIM_PRIVATE_KEY)." };
    if (e instanceof CheckinError) return { ok: false, error: e.code.replaceAll("_", " ") };
    return { ok: false, error: "The tablet could not sign." };
  }
}
