import { describe, expect, it } from "vitest";
import { toCsv, toJsonl } from "./serialize";

describe("toJsonl", () => {
  it("writes one JSON object per line with a trailing newline", () => {
    const out = toJsonl([{ a: 1, b: "x\ny" }, { a: 2, b: null }]);
    expect(out).toBe('{"a":1,"b":"x\\ny"}\n{"a":2,"b":null}\n');
    expect(out.trimEnd().split("\n").map((l) => JSON.parse(l))).toEqual([{ a: 1, b: "x\ny" }, { a: 2, b: null }]);
  });

  it("returns an empty string for no rows", () => {
    expect(toJsonl([])).toBe("");
  });
});

describe("toCsv", () => {
  it("writes a header row and rows in column order", () => {
    expect(toCsv(["id", "path"], [{ path: "/a", id: 1 }])).toBe("id,path\r\n1,/a\r\n");
  });

  it("quotes cells with commas, quotes, CR or LF and doubles inner quotes", () => {
    const out = toCsv(["v"], [{ v: "a,b" }, { v: 'say "hi"' }, { v: "l1\nl2" }, { v: "c\rd" }]);
    expect(out).toBe('v\r\n"a,b"\r\n"say ""hi"""\r\n"l1\nl2"\r\n"c\rd"\r\n');
  });

  it("JSON-stringifies objects and leaves null and undefined empty", () => {
    const out = toCsv(["o", "n", "u", "d"], [{ o: { k: "v", n: [1, 2] }, n: null, d: new Date("2026-10-17T00:00:00.000Z") }]);
    expect(out).toBe('o,n,u,d\r\n"{""k"":""v"",""n"":[1,2]}",,,2026-10-17T00:00:00.000Z\r\n');
  });

  it("prefixes formula-like strings with a single quote", () => {
    const out = toCsv(["v"], [{ v: "=SUM(A1)" }, { v: "+1" }, { v: "-2" }, { v: "@cmd" }, { v: "\tx" }, { v: "\rx" }, { v: "ok" }]);
    expect(out.split("\r\n").slice(1, -1)).toEqual(["'=SUM(A1)", "'+1", "'-2", "'@cmd", "'\tx", "\"'\rx\"", "ok"]);
  });

  it("does not prefix numbers, so negative amounts stay numeric", () => {
    expect(toCsv(["amount"], [{ amount: -45 }])).toBe("amount\r\n-45\r\n");
  });
});
