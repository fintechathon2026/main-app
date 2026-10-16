import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "11111111-1111-4111-8111-111111111111";
const PLAN = "22222222-2222-4222-8222-222222222222";

const session = vi.hoisted(() => ({ userId: null as string | null }));
const runMock = vi.hoisted(() => ({
  startPlan: vi.fn(),
  resumePlan: vi.fn(),
}));

vi.mock("@/src/server/auth/session", () => ({ getSessionUserId: async () => session.userId }));
vi.mock("@/src/agent/run", async () => {
  class PlanNotFoundError extends Error {}
  return { ...runMock, PlanNotFoundError };
});

const { POST: chat } = await import("@/app/api/chat/route");
const { POST: resume } = await import("@/app/api/agent/resume/route");
const { PlanNotFoundError } = await import("@/src/agent/run");

const post = (body: unknown) =>
  new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  session.userId = USER;
  runMock.startPlan.mockReset();
  runMock.resumePlan.mockReset();
});

describe("POST /api/chat", () => {
  it("requires a session", async () => {
    session.userId = null;
    expect((await chat(post({ message: "hi" }))).status).toBe(401);
  });

  it("rejects a body that tries to carry userId", async () => {
    expect((await chat(post({ message: "hi", userId: "someone" }))).status).toBe(400);
    expect(runMock.startPlan).not.toHaveBeenCalled();
  });

  it("streams NDJSON events for the session user", async () => {
    runMock.startPlan.mockImplementation(async function* () {
      yield { type: "plan", planId: PLAN };
      yield { type: "done", planId: PLAN, route: "none" };
    });
    const res = await chat(post({ message: "how much did I spend?" }));
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toEqual([
      { type: "plan", planId: PLAN },
      { type: "done", planId: PLAN, route: "none" },
    ]);
    expect(runMock.startPlan.mock.calls[0][0]).toMatchObject({ userId: USER, trigger: "chat", message: "how much did I spend?" });
  });
});

describe("POST /api/agent/resume", () => {
  it("accepts only { planId }: no userId, no approval status", async () => {
    for (const body of [{ planId: PLAN, userId: USER }, { planId: PLAN, approved: true }, { planId: "not-a-uuid" }]) {
      expect((await resume(post(body))).status).toBe(400);
    }
    expect(runMock.resumePlan).not.toHaveBeenCalled();
  });

  it("passes the session user and maps a foreign plan to 404", async () => {
    runMock.resumePlan.mockRejectedValueOnce(new PlanNotFoundError());
    expect((await resume(post({ planId: PLAN }))).status).toBe(404);
    expect(runMock.resumePlan).toHaveBeenCalledWith({ planId: PLAN, userId: USER });

    runMock.resumePlan.mockResolvedValueOnce({ planId: PLAN, status: "done", feed: ["x"] });
    const ok = await resume(post({ planId: PLAN }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ planId: PLAN, status: "done", feed: ["x"] });
  });
});
