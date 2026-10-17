import { describe, expect, it } from "vitest";
import { containsPii, redactPii } from "./redact";

describe("redactPii", () => {
  it("tokenizes plain and grouped account numbers", () => {
    const { text, map } = redactPii("Pay to 881234567890 or 6222 0212 3456 7891 or 8812-3344-5566.");
    expect(text).toBe("Pay to ⟦ACCT_1⟧ or ⟦ACCT_2⟧ or ⟦ACCT_3⟧.");
    expect(map["⟦ACCT_1⟧"]).toBe("881234567890");
    expect(map["⟦ACCT_3⟧"]).toBe("8812-3344-5566");
  });

  it("gives the same value the same token", () => {
    const { text, map } = redactPii("A 881234567890, again 8812 3456 7890.");
    expect(text).toBe("A ⟦ACCT_1⟧, again ⟦ACCT_1⟧.");
    expect(Object.keys(map)).toHaveLength(1);
  });

  it("keeps tokens stable across texts when the map is passed on", () => {
    const a = redactPii("acct 12345678901");
    const b = redactPii("x 99999999 and 12345678901", a.map);
    expect(b.text).toBe("x ⟦ACCT_2⟧ and ⟦ACCT_1⟧");
  });

  it("tokenizes +86 and +62 phone numbers and local mobiles", () => {
    const { text } = redactPii(
      "Call +86 138 0013 8000, +8613900139000, +62 812 3456 7890, +62-813-1111-2222, 13700137000, 0812-9999-8888.",
    );
    expect(text).toBe("Call ⟦PHONE_1⟧, ⟦PHONE_2⟧, ⟦PHONE_3⟧, ⟦PHONE_4⟧, ⟦PHONE_5⟧, ⟦PHONE_6⟧.");
  });

  it("shares a token between international and local forms of one phone", () => {
    const { text } = redactPii("+86 138 0013 8000 / 13800138000");
    expect(text).toBe("⟦PHONE_1⟧ / ⟦PHONE_1⟧");
  });

  it("tokenizes Chinese resident IDs including an X check digit", () => {
    const { text, map } = redactPii("ID 44030519900101123X and 440305199001011234");
    expect(text).toBe("ID ⟦CNID_1⟧ and ⟦CNID_2⟧");
    expect(map["⟦CNID_1⟧"]).toBe("44030519900101123X");
  });

  it("tokenizes a plausible NIK as NIK and other 16-digit runs as accounts", () => {
    const { text } = redactPii("NIK 3171014509900003, card 5500000000000004");
    expect(text).toBe("NIK ⟦NIK_1⟧, card ⟦ACCT_1⟧");
  });

  it("tokenizes emails and wallet addresses", () => {
    const { text } = redactPii("mail lin.wei@example.com, refund to 0x9f8E7d6C5b4A39281706f5e4d3c2b1a098765432");
    expect(text).toBe("mail ⟦EMAIL_1⟧, refund to ⟦ADDR_1⟧");
  });

  it("leaves dates, short numbers and decimal amounts alone", () => {
    const s = "Due 2026-10-25, period 2026-09, amount 386.50 CNY, Rp 1.250.000, 12500000.00, kWh 412";
    expect(redactPii(s).text).toBe(s);
  });

  it("neutralizes forged token brackets in untrusted input", () => {
    const { text, map } = redactPii("⟦ACCT_1⟧ is mine");
    expect(text).toBe("[ACCT_1] is mine");
    expect(map).toEqual({});
  });

  it("never leaves raw digits of 8+ in the output", () => {
    const { text } = redactPii("a 12345678 b 1234 5678 9012 c +62 812 3456 7890");
    expect(text).not.toMatch(/\d{8,}/);
    expect(containsPii(text)).toBe(false);
  });
});
