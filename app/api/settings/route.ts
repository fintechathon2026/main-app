// Owner: R3 (roles.md).
// GET|PATCH /api/settings (architecture §8). Session-scoped. PATCH accepts displayName, locale and
// timezone only; baseCurrency and any other key are rejected (base currency follows the mandate).

import fixture from "@/fixtures/api/settings.json";
import type { SettingsResponse } from "@/src/server/api-types";
import { jsonError, readRoute } from "@/src/server/db/read/http";
import { getSettings, SettingsPatch, updateSettings } from "@/src/server/platform/settings";

const settingsFixture = () => fixture as SettingsResponse;

export async function GET(req: Request): Promise<Response> {
  return readRoute<SettingsResponse>(req, settingsFixture, async (d) => (await getSettings(d.userId)) ?? jsonError(404, "user not found", "not_found"));
}

export async function PATCH(req: Request): Promise<Response> {
  return readRoute<SettingsResponse>(req, settingsFixture, async (d) => {
    const patch = SettingsPatch.safeParse(await req.json().catch(() => undefined));
    if (!patch.success) return jsonError(400, "invalid settings update", "bad_request");
    if (!(await updateSettings(d.userId, patch.data))) return jsonError(404, "user not found", "not_found");
    return (await getSettings(d.userId)) ?? jsonError(404, "user not found", "not_found");
  });
}
