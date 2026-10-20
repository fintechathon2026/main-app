// I-02 (G1): only src/server/executor/** imports settlement adapters, including the chain adapter.
// Two checks: the ESLint rule really fires for the paths that matter, and a source scan finds no
// import outside the executor (it also catches dynamic import() and require(), which
// no-restricted-imports does not see, and files the TS-only rule does not cover).

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const RULE = "no-restricted-imports";

const SPECIFIERS = [
  "@/src/server/adapters/settlement/chain/escrow",
  "@/src/server/adapters/settlement/mockbank",
  "@/src/server/adapters/settlement",
];

describe("I-02: ESLint rule for settlement adapter imports", () => {
  const eslint = new ESLint({ cwd: ROOT });
  const lint = async (filePath: string, spec: string) => {
    const [res] = await eslint.lintText(`import * as a from "${spec}";\nexport const x = a;\n`, { filePath: path.join(ROOT, filePath) });
    return res.messages.filter((m) => m.ruleId === RULE);
  };

  it.each([
    "app/api/agent/resume/route.ts",
    "app/api/example/route.ts",
    "src/agent/nodes/example.ts",
    "src/server/chain/example.ts",
    "src/server/approvals/example.ts",
    "src/ui/screens/example.tsx",
    "src/core/gate/example.ts",
    "src/sim/merchant/example.ts",
  ])("forbids every adapter import in %s", async (file) => {
    for (const spec of SPECIFIERS) expect((await lint(file, spec)).length, `${file} <- ${spec}`).toBeGreaterThan(0);
  }, 60_000);

  it("forbids a relative import of the chain adapter", async () => {
    expect((await lint("src/server/chain/example.ts", "../adapters/settlement/chain/escrow")).length).toBeGreaterThan(0);
  }, 60_000);

  it("allows the executor to import adapters", async () => {
    for (const spec of SPECIFIERS) expect(await lint("src/server/executor/example.ts", spec)).toEqual([]);
  }, 60_000);
});

describe("I-02: source scan", () => {
  const SCAN = ["app", "src", "scripts"];
  const files: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (e === "node_modules" || e.startsWith(".")) continue;
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(e)) files.push(p);
    }
  };
  for (const d of SCAN) walk(path.join(ROOT, d));

  // import ... from "x", export ... from "x", import("x"), require("x"), with x naming the adapters.
  const ADAPTER_IMPORT = /(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s+)["'][^"']*adapters\/settlement(?:\/[^"']*)?["']/;

  it("finds files to scan", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("no file outside src/server/executor/** and the adapters themselves imports a settlement adapter", () => {
    const offenders = files
      .map((f) => path.relative(ROOT, f).split(path.sep).join("/"))
      .filter((rel) => !rel.startsWith("src/server/executor/") && !rel.startsWith("src/server/adapters/settlement/"))
      .filter((rel) => ADAPTER_IMPORT.test(readFileSync(path.join(ROOT, rel), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the executor is where the chain adapter is wired", () => {
    const executor = files.filter((f) => f.includes(`${path.sep}src${path.sep}server${path.sep}executor${path.sep}`));
    expect(executor.some((f) => /adapters\/settlement\/chain/.test(readFileSync(f, "utf8")))).toBe(true);
  });
});
