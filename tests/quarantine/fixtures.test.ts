import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PDF_FIXTURES, buildPdf } from "@/scripts/gen-fixture-pdfs";

const root = join(__dirname, "..", "..");

type AttackIndex = {
  cases: { id: string; category: number; kind: "document" | "signals"; file: string; canary: string }[];
};

describe("attack fixtures", () => {
  it("committed PDFs match the generator output", () => {
    for (const f of PDF_FIXTURES) {
      const committed = new Uint8Array(readFileSync(join(root, f.path)));
      expect(Buffer.from(committed).equals(Buffer.from(buildPdf(f.spec))), f.path).toBe(true);
    }
  });

  it("index lists existing files with unique ids and canaries", () => {
    const index = JSON.parse(readFileSync(join(root, "evals/cases/attacks/index.json"), "utf8")) as AttackIndex;
    const ids = new Set<string>();
    const canaries = new Set<string>();
    for (const c of index.cases) {
      expect(ids.has(c.id)).toBe(false);
      expect(canaries.has(c.canary)).toBe(false);
      ids.add(c.id);
      canaries.add(c.canary);
      expect([1, 10, 23, 24]).toContain(c.category);
      const body = readFileSync(join(root, "evals/cases/attacks", c.file));
      // The canary is somewhere in the fixture (PDF bytes or JSON text).
      expect(body.toString("latin1")).toContain(c.canary);
    }
  });
});
