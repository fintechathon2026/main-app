// Feed copy comes from fixed templates (architecture §15.3, PRD §18.2).

import { describe, expect, it } from "vitest";
import { headline, reasonText, tierOf } from "@/src/server/feed/templates";

describe("feed templates", () => {
  it("maps action status to a tier", () => {
    expect(tierOf("succeeded", "allow", false)).toBe("auto");
    expect(tierOf("succeeded", "allow", true)).toBe("approved");
    expect(tierOf("denied", "deny", false)).toBe("denied");
    expect(tierOf("awaiting_approval", "require_confirm", false)).toBe("waiting");
    expect(tierOf("unknown", "allow", false)).toBe("failed");
  });

  it("writes headlines from the tool and registry name", () => {
    expect(headline("pay_bill", "China Mobile", "auto")).toBe("Paid China Mobile");
    expect(headline("pay_bill", "State Grid Shenzhen", "denied")).toBe("Blocked: pay State Grid Shenzhen");
    expect(headline("cancel_subscription", "iQIYI", "waiting")).toBe("Waiting for you: cancel iQIYI");
    expect(headline("prepaid_exit", "FitBox Futian", "auto")).toBe("Exited plan with FitBox Futian, refund sent to you");
  });

  it("says what would make a denial allowed", () => {
    expect(reasonText("provenance.destination_not_registry").fix).toMatch(/Payees/);
    expect(reasonText("global.kill_switch.on").fix).toMatch(/kill switch/i);
    expect(reasonText("unknown.key_here").why).toBe("unknown: key here");
  });
});
