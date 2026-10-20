// Owner: R2 (roles.md). Loads the user's signed mandates for the Mandate Card. Runs in
// `withUserTx` (RLS) and filters by user. Read only: nothing here activates or edits a mandate
// (G6). Not exercised without a database.

import type { MandateActiveResponse, MandateHistoryResponse } from "../../api-types";
import { withUserTx } from "../pool";
import { type MandateRow, buildActive, buildHistory } from "./mandate-view";

const COLUMNS = "version, policy_json, policy_hash, signed_at, status, created_via";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toRow = (r: any): MandateRow => ({
  version: Number(r.version),
  policyJson: r.policy_json,
  policyHash: r.policy_hash,
  signedAt: r.signed_at instanceof Date ? r.signed_at.toISOString() : new Date(r.signed_at).toISOString(),
  status: r.status,
  createdVia: r.created_via,
});

/** The one `active` mandate, or null if the user has none yet. */
export async function loadActiveMandate(userId: string): Promise<MandateActiveResponse | null> {
  const row = await withUserTx(userId, async (tx) => {
    const r = await tx.query(`select ${COLUMNS} from public.mandates where user_id = $1 and status = 'active'`, [userId]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  });
  return row ? buildActive(row) : null;
}

export async function loadMandateHistory(userId: string): Promise<MandateHistoryResponse> {
  const rows = await withUserTx(userId, async (tx) => {
    const r = await tx.query(`select ${COLUMNS} from public.mandates where user_id = $1 order by version`, [userId]);
    return r.rows.map(toRow);
  });
  return buildHistory(rows);
}
