// Shared plumbing for the user-initiated prepaid routes (architecture §13, §24.10).

import type { ApiError } from "@/src/server/api-types";
import { UserActionError, type UserActionResponse } from "@/src/server/prepaid/user-actions";

export const noStore = { "cache-control": "no-store" };
export const err = (status: number, error: string, code?: string) => Response.json({ error, ...(code ? { code } : {}) } satisfies ApiError, { status, headers: noStore });

const STATUS: Record<UserActionError["code"], number> = { invalid: 400, not_found: 404, no_wallet: 409, no_mandate: 409, plan_not_active: 409 };

export function userActionError(e: unknown, label: string): Response {
  if (e instanceof UserActionError) return err(STATUS[e.code], e.code.replaceAll("_", " "), e.code);
  console.error(JSON.stringify({ msg: `${label} failed`, error: e instanceof Error ? e.message : String(e) }));
  return err(500, "internal");
}

/** 200 when it ran (whatever the decision: the body says allow/deny), 202 when it waits for approval. */
export const actionResult = (r: UserActionResponse) => Response.json(r, { status: r.status === "awaiting_approval" ? 202 : 200, headers: noStore });
