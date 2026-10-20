// Owner: R3 (roles.md).
// The user's settings view and profile edits (architecture §8). Everything runs under RLS for the
// signed-in user. Base currency is read-only here: it is bound to the signed mandate (G6), so a
// change goes through a new mandate, never through a settings PATCH.

import { z } from "zod";
import type { SettingsResponse, SettingsUpdateRequest } from "../api-types";
import { appendAudit } from "../audit";
import { withUserTx } from "../db/pool";

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Strict: unknown keys (baseCurrency, email, id, ...) are rejected, not ignored. */
export const SettingsPatch = z
  .strictObject({
    displayName: z.string().trim().min(1).max(80).optional(),
    locale: z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/).optional(),
    timezone: z.string().min(1).max(64).refine(isTimeZone, "unknown time zone").optional(),
  })
  .refine((p) => Object.keys(p).length > 0, "nothing to update") satisfies z.ZodType<SettingsUpdateRequest>;

const COLUMNS = { displayName: "display_name", locale: "locale", timezone: "timezone" } as const;

export async function getSettings(userId: string): Promise<SettingsResponse | null> {
  return withUserTx(userId, async (tx) => {
    const u = await tx.query("select email, display_name, locale, timezone, base_currency from public.users where id = $1", [userId]);
    if (!u.rows[0]) return null;
    const ks = await tx.query("select enabled, changed_at from public.kill_switch where user_id = $1", [userId]);
    const m = await tx.query("select version from public.mandates where user_id = $1 and status = 'active'", [userId]);
    const ds = await tx.query(
      "select id, type, status, last_synced_at from public.data_sources where user_id = $1 order by created_at, id",
      [userId],
    );
    const user = u.rows[0];
    return {
      profile: {
        email: user.email ?? null,
        displayName: user.display_name ?? null,
        locale: user.locale,
        timezone: user.timezone,
        baseCurrency: user.base_currency,
      },
      killSwitch: ks.rows[0] ? { enabled: !!ks.rows[0].enabled, changedAt: iso(ks.rows[0].changed_at) } : { enabled: false, changedAt: null },
      mandateVersion: m.rows[0] ? Number(m.rows[0].version) : null,
      dataSources: ds.rows.map((r) => ({ id: r.id, type: r.type, status: r.status, lastSyncedAt: iso(r.last_synced_at) })),
    };
  });
}

/** Applies an already-validated patch (see SettingsPatch). Returns false if the user row is missing. */
export async function updateSettings(userId: string, patch: SettingsUpdateRequest): Promise<boolean> {
  const fields = (Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]).filter((k) => patch[k] !== undefined);
  if (fields.length === 0) return true;
  return withUserTx(userId, async (tx) => {
    // Column names come from the fixed COLUMNS map, values are parameters.
    const sets = fields.map((f, i) => `${COLUMNS[f]} = $${i + 2}`).join(", ");
    const r = await tx.query(`update public.users set ${sets} where id = $1`, [userId, ...fields.map((f) => patch[f])]);
    if (r.rowCount !== 1) return false;
    // Field names only: display names and the like are personal data and stay out of the log.
    await appendAudit(tx, userId, { actor: "user", eventType: "settings.changed", data: { fields } });
    return true;
  });
}
