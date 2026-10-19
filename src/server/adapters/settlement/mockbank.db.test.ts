// Owner: R3 (roles.md).
// Mock bank settlement adapter: transferInternal and lookup against the in-process mock bank.
// Lives next to the adapter because only executor and adapter code may import it (ESLint, G1).
// Skipped when DATABASE_URL is not set.

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getMockbankPool, setMockbankPool } from "@/src/mockbank/db";
import { DB_ENABLED, adminPool, createTestUser, inProcessTransport } from "@/tests/foundations/helpers";
import { createMockbankSettlement } from "./mockbank";
import { SettlementError } from "./types";

describe.skipIf(!DB_ENABLED)("mock bank adapter: transferInternal", () => {
  let admin: Pool;
  const adapter = createMockbankSettlement({ transport: inProcessTransport });

  beforeAll(() => {
    process.env.MOCKBANK_API_KEY ??= "test-mockbank-key";
    admin = adminPool();
  });

  afterAll(async () => {
    await admin.end();
    await getMockbankPool().end();
    setMockbankPool(null);
  });

  it("sweeps to the customer's savings, replays by key and is found by lookup", async () => {
    const u = await createTestUser(admin, []);
    const s = await admin.query(
      `insert into mockbank.accounts (customer_id, name, type, currency, balance, is_default)
       values ($1, 'Test savings', 'savings', 'CNY', 0, false) returning id`,
      [u.id],
    );
    const key = `sweep:${randomUUID()}`;
    const r1 = await adapter.transferInternal({ amount: 1200 }, { customerId: u.id, idempotencyKey: key });
    expect(r1.status).toBe("succeeded");
    expect(r1.reference).toMatch(/^[0-9a-f-]{36}$/);
    const r2 = await adapter.transferInternal({ amount: 1200 }, { customerId: u.id, idempotencyKey: key });
    expect(r2.reference).toBe(r1.reference);

    const row = await admin.query("select to_account_id, amount::int as amount from mockbank.transfers where id = $1", [r1.reference]);
    expect(row.rows).toEqual([{ to_account_id: s.rows[0].id, amount: 1200 }]);

    const found = await adapter.lookup(key);
    expect(found?.reference).toBe(r1.reference);
  });

  it("maps bank refusals to definitive SettlementErrors", async () => {
    const u = await createTestUser(admin, []);
    const err = await adapter
      .transferInternal({ amount: 100 }, { customerId: u.id, idempotencyKey: `sweep:${randomUUID()}` })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SettlementError);
    expect(err).toMatchObject({ code: "no_savings_account", definitive: true });
  });
});
