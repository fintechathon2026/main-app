import { beforeEach, describe, expect, it, vi } from "vitest";

const LIN = "11111111-1111-4111-8111-111111111111";
const MALLORY = "33333333-3333-4333-8333-333333333333";
const APPROVAL = "44444444-4444-4444-8444-444444444444";
const ACTION = "55555555-5555-4555-8555-555555555555";
const PLAN = "22222222-2222-4222-8222-222222222222";

const session = vi.hoisted(() => ({ userId: null as string | null }));
const run = vi.hoisted(() => ({ resumePlan: vi.fn() }));
const cards = vi.hoisted(() => ({ listPendingCards: vi.fn(), planIdForAction: vi.fn() }));

/**
 * In-memory stand-in for the approvals row with the same rules as decideApproval in Postgres:
 * owner only (others see not_found), pending only, unexpired (expiry is committed, then thrown).
 */
const db = vi.hoisted(() => ({
  rows: new Map<string, { userId: string; actionId: string; status: string; expiresAt: number }>(),
}));

vi.mock("@/src/server/auth/session", async (orig) => ({
  ...(await orig<typeof import("@/src/server/auth/session")>()),
  getSessionUserId: async () => session.userId,
}));
vi.mock("@/src/agent/run", () => run);
vi.mock("@/app/api/approvals/_lib/cards", () => cards);
vi.mock("@/src/server/approvals", async (orig) => {
  const actual = await orig<typeof import("@/src/server/approvals")>();
  return {
    ...actual,
    decideApproval: async (userId: string, approvalId: string, decision: "approve" | "reject") => {
      const row = db.rows.get(approvalId);
      if (!row || row.userId !== userId) throw new actual.ApprovalError("not_found");
      if (row.status !== "pending") throw new actual.ApprovalError("not_pending");
      if (row.expiresAt <= Date.now()) {
        row.status = "expired";
        throw new actual.ApprovalError("expired");
      }
      row.status = decision === "approve" ? "approved" : "rejected";
      return { approvalId, actionId: row.actionId, status: row.status };
    },
  };
});

const { GET: list } = await import("@/app/api/approvals/route");
const { POST: decide } = await import("@/app/api/approvals/[id]/route");

const post = (id: string, body: unknown) =>
  decide(
    new Request(`http://localhost/api/approvals/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

beforeEach(() => {
  session.userId = LIN;
  db.rows.clear();
  db.rows.set(APPROVAL, { userId: LIN, actionId: ACTION, status: "pending", expiresAt: Date.now() + 15 * 60_000 });
  run.resumePlan.mockReset();
  run.resumePlan.mockResolvedValue({ planId: PLAN, status: "done", feed: ["Exited."] });
  cards.planIdForAction.mockReset();
  cards.planIdForAction.mockResolvedValue(PLAN);
  cards.listPendingCards.mockReset();
  cards.listPendingCards.mockResolvedValue([]);
});

describe("POST /api/approvals/:id", () => {
  it("approves for the owner, then resumes that plan once", async () => {
    const res = await post(APPROVAL, { decision: "approve" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      approvalId: APPROVAL,
      status: "approved",
      planId: PLAN,
      resume: { planId: PLAN, status: "done", feed: ["Exited."] },
    });
    expect(cards.planIdForAction).toHaveBeenCalledWith(LIN, ACTION);
    expect(run.resumePlan).toHaveBeenCalledTimes(1);
    expect(run.resumePlan).toHaveBeenCalledWith({ planId: PLAN, userId: LIN });
  });

  it("rejects a non-owner as not found and resumes nothing", async () => {
    session.userId = MALLORY;
    const res = await post(APPROVAL, { decision: "approve" });
    expect(res.status).toBe(404);
    expect(db.rows.get(APPROVAL)!.status).toBe("pending");
    expect(run.resumePlan).not.toHaveBeenCalled();
  });

  it("rejects an expired approval", async () => {
    db.rows.get(APPROVAL)!.expiresAt = Date.now() - 1;
    const res = await post(APPROVAL, { decision: "approve" });
    expect(res.status).toBe(410);
    expect((await res.json()).code).toBe("expired");
    expect(db.rows.get(APPROVAL)!.status).toBe("expired");
    expect(run.resumePlan).not.toHaveBeenCalled();
  });

  it("rejects a double approve", async () => {
    expect((await post(APPROVAL, { decision: "approve" })).status).toBe(200);
    const second = await post(APPROVAL, { decision: "approve" });
    expect(second.status).toBe(409);
    expect((await second.json()).code).toBe("not_pending");
    expect(run.resumePlan).toHaveBeenCalledTimes(1);
  });

  it("cannot approve after a reject", async () => {
    expect((await post(APPROVAL, { decision: "reject", reason: "keep the plan" })).status).toBe(200);
    expect((await post(APPROVAL, { decision: "approve" })).status).toBe(409);
  });

  it("requires a session, a uuid and a strict body", async () => {
    session.userId = null;
    expect((await post(APPROVAL, { decision: "approve" })).status).toBe(401);
    session.userId = LIN;
    expect((await post("not-a-uuid", { decision: "approve" })).status).toBe(404);
    for (const body of [{ decision: "yes" }, { decision: "approve", userId: LIN }, { decision: "approve", status: "approved" }, {}]) {
      expect((await post(APPROVAL, body)).status).toBe(400);
    }
    expect(db.rows.get(APPROVAL)!.status).toBe("pending");
    expect(run.resumePlan).not.toHaveBeenCalled();
  });

  it("a failed resume does not undo the decision", async () => {
    run.resumePlan.mockRejectedValueOnce(new Error("graph down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post(APPROVAL, { decision: "approve" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "approved", planId: PLAN, resume: null });
  });
});

describe("GET /api/approvals", () => {
  const get = (q = "?status=pending") => list(new Request(`http://localhost/api/approvals${q}`));

  it("requires a session and lists only the session user's cards", async () => {
    session.userId = null;
    expect((await get()).status).toBe(401);
    session.userId = LIN;
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
    expect(cards.listPendingCards).toHaveBeenCalledWith(LIN);
  });

  it("supports only status=pending", async () => {
    expect((await get("?status=approved")).status).toBe(400);
    expect((await get("")).status).toBe(200);
  });
});
