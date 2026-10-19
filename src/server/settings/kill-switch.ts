// Owner: R3 (roles.md). Kill switch (architecture §14.5, PRD §18.1 #1). Phase B reads it in the
// snapshot and denies every action while it is on; money already in escrow stays put.

import { appendAudit } from "@/src/server/audit";
import { withUserTx } from "@/src/server/db/pool";

export type KillSwitchState = { enabled: boolean; changedAt: string };

export function getKillSwitch(userId: string): Promise<KillSwitchState> {
  return withUserTx(userId, async (tx) => {
    const r = await tx.query<{ enabled: boolean; changed_at: Date }>("select enabled, changed_at from public.kill_switch where user_id = $1", [userId]);
    const row = r.rows[0];
    return { enabled: row?.enabled ?? false, changedAt: (row?.changed_at ?? new Date(0)).toISOString() };
  });
}

export function setKillSwitch(userId: string, enabled: boolean): Promise<KillSwitchState> {
  return withUserTx(userId, async (tx) => {
    const r = await tx.query<{ enabled: boolean; changed_at: Date }>(
      `insert into public.kill_switch (user_id, enabled, changed_at) values ($1, $2, now())
       on conflict (user_id) do update set enabled = excluded.enabled, changed_at = now()
       returning enabled, changed_at`,
      [userId, enabled],
    );
    await appendAudit(tx, userId, { actor: "user", eventType: enabled ? "kill_switch.on" : "kill_switch.off", data: { enabled } });
    return { enabled: r.rows[0].enabled, changedAt: r.rows[0].changed_at.toISOString() };
  });
}
