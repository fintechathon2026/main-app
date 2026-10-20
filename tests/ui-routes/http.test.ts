// Owner: R2 (roles.md). Fixture mode guard in the shared read-route plumbing. No database needed.

import { afterEach, describe, expect, it, vi } from "vitest";
import { fixturesEnabled } from "@/src/server/db/read/http";

afterEach(() => vi.unstubAllEnvs());

describe("fixturesEnabled", () => {
  it("is on only when REINS_FIXTURES=1", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("REINS_FIXTURES", "1");
    expect(fixturesEnabled()).toBe(true);
    vi.stubEnv("REINS_FIXTURES", "");
    expect(fixturesEnabled()).toBe(false);
    vi.stubEnv("REINS_FIXTURES", "true");
    expect(fixturesEnabled()).toBe(false);
  });

  it("stays on under NODE_ENV=production (the e2e build) and on Vercel previews", () => {
    vi.stubEnv("REINS_FIXTURES", "1");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "");
    expect(fixturesEnabled()).toBe(true);
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(fixturesEnabled()).toBe(true);
  });

  it("is off on a Vercel production deployment even with REINS_FIXTURES=1", () => {
    vi.stubEnv("REINS_FIXTURES", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(fixturesEnabled()).toBe(false);
  });
});
