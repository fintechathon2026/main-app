// Owner: R3 (roles.md).
// R3's fixtures/api/*.json are hand-written (no view builder produces them); they must parse
// against the zod mirror of src/server/api-types.ts. No database needed.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { auditHash, GENESIS_HASH } from "@/src/server/audit";
import * as S from "./api-schemas";

const DIR = join(process.cwd(), "fixtures", "api");
const LIN = "11111111-1111-4111-8111-111111111111";

const SCHEMAS: Record<string, z.ZodType> = {
  "kill-switch.json": S.KillSwitchResponse,
  "settings.json": S.SettingsResponse,
  "run-now.json": S.RunNowResponse,
  "audit-export.json": S.AuditExport,
};

const read = (f: string) => JSON.parse(readFileSync(join(DIR, f), "utf8")) as unknown;

describe("R3 fixtures/api", () => {
  for (const [file, schema] of Object.entries(SCHEMAS)) {
    it(`${file} matches its api-types schema`, () => {
      const r = schema.safeParse(read(file));
      expect(r.success, r.success ? "" : `${file}: ${r.error.message}`).toBe(true);
    });
  }

  it("settings.json is Lin's synthetic profile", () => {
    const s = S.SettingsResponse.parse(read("settings.json"));
    expect(s.profile).toMatchObject({ email: "lin@demo.reins.local", locale: "zh-CN", timezone: "Asia/Shanghai", baseCurrency: "CNY" });
    expect(s.mandateVersion).toBe(3);
    expect(s.dataSources).toEqual([expect.objectContaining({ id: "d0000000-0000-4000-8000-000000000001", type: "mock_bank" })]);
  });

  it("audit-export.json is a valid hash chain for Lin", () => {
    const rows = S.AuditExport.parse(read("audit-export.json"));
    expect(rows).toHaveLength(2);
    let prev = GENESIS_HASH;
    for (const r of rows) {
      expect(r.prevHash).toBe(prev);
      expect(auditHash(r.prevHash, LIN, r.actor, r.eventType, r.event)).toBe(r.hash);
      prev = r.hash;
    }
  });
});
