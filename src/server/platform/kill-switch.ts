// Owner: R3 (roles.md).
// The user's kill switch (PRD §10.4, architecture §8): while on, the Gate denies every action
// (`global.kill_switch`). Reads and writes run under RLS for the signed-in user only, and each
// change appends an audit entry in the same transaction (G7).

import type { KillSwitchResponse } from "../api-types";
import { appendAudit } from "../audit";
import { withUserTx } from "../db/pool";

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));

export async function getKillSwitch(userId: string): Promise<KillSwitchResponse> {
  return withUserTx(userId, async (tx) => {
    const r = await tx.query("select enabled, changed_at from public.kill_switch where user_id = $1", [userId]);
    // No row = never switched on; the executor snapshot treats it the same way.
    return r.rows[0] ? { enabled: !!r.rows[0].enabled, changedAt: iso(r.rows[0].changed_at) } : { enabled: false, changedAt: null };
  });
}

export async function setKillSwitch(userId: string, enabled: boolean): Promise<KillSwitchResponse> {
  return withUserTx(userId, async (tx) => {
    // Lock the row so two concurrent toggles audit the right `previous` value.
    const prev = await tx.query("select enabled from public.kill_switch where user_id = $1 for update", [userId]);
    const previous = prev.rows[0] ? !!prev.rows[0].enabled : false;
    const r = await tx.query(
      `insert into public.kill_switch (user_id, enabled, changed_at) values ($1, $2, now())
       on conflict (user_id) do update set enabled = excluded.enabled, changed_at = now()
       returning enabled, changed_at`,
      [userId, enabled],
    );
    await appendAudit(tx, userId, { actor: "user", eventType: "kill_switch.changed", data: { enabled, previous } });
    return { enabled: !!r.rows[0].enabled, changedAt: iso(r.rows[0].changed_at) };
  });
}
