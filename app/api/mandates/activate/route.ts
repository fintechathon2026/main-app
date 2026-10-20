// Owner: R2 (roles.md).
// POST /api/mandates/activate (architecture §9.1, §9.2): the user has read the compiled
// read-back and signs it. Body {policy, createdVia, confirmWidening?}; the user comes from the
// session. The server recomputes defaults, version, hash and the change class from the policy and
// never trusts a client hash or direction. Narrowing and equivalent changes activate at once; a
// widening or incomparable change without `confirmWidening: true` answers 409
// widening_needs_review and writes nothing. R0 signs by session; passkey + UV is R1.
// REINS_FIXTURES=1 serves fixtures/api/mandates-activate.json.
//
// G6: the LLM never calls this route, and src/agent/** may not import the activation service.
// No `runtime` export: cacheComponents is on, and Node is the default runtime.

import { connection } from "next/server";
import { z } from "zod";
import fixture from "@/fixtures/api/mandates-activate.json";
import type { MandateActivateConflict, MandateActivateResponse } from "@/src/server/api-types";
import { getSessionUserId } from "@/src/server/auth/session";
import { fixturesEnabled, jsonError } from "@/src/server/db/read/http";
import { activateReviewed, parseActivatePolicy } from "@/src/server/mandate/activate";

/** The largest valid policy JSON is a few KiB; 16 KiB leaves room to spare. */
const MAX_BODY_BYTES = 16 * 1024;
const tooLarge = () => jsonError(413, `body must be at most ${MAX_BODY_BYTES} bytes`, "payload_too_large");
const badBody = (detail?: string) =>
  jsonError(400, `body must be {policy, createdVia: "nl"|"template"|"edit", confirmWidening?: boolean}${detail ? `: ${detail}` : ""}`, "bad_request");

const Body = z.strictObject({
  policy: z.unknown(),
  createdVia: z.enum(["nl", "template", "edit"]),
  confirmWidening: z.boolean().optional(),
});

/** Reads the JSON body with a byte cap: by content-length first, then while streaming. */
async function readJson(req: Request): Promise<{ value: unknown } | Response> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return tooLarge();
  if (!req.body) return { value: undefined };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      return tooLarge();
    }
    chunks.push(value);
  }
  try {
    return { value: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown };
  } catch {
    return { value: undefined };
  }
}

const isJson = (req: Request) => (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase() === "application/json";

export async function POST(req: Request): Promise<Response> {
  await connection(); // always render at request time (cacheComponents)
  if (fixturesEnabled()) return Response.json(fixture as MandateActivateResponse, { status: 201 });

  const userId = await getSessionUserId(req);
  if (!userId) return jsonError(401, "unauthorized");
  if (!isJson(req)) return jsonError(415, "content-type must be application/json", "unsupported_media_type");

  const raw = await readJson(req);
  if (raw instanceof Response) return raw;
  const body = Body.safeParse(raw.value);
  if (!body.success) return badBody();
  const policy = parseActivatePolicy(body.data.policy);
  if (!policy.ok) return badBody(policy.errors.join("; "));

  try {
    const out = await activateReviewed(userId, policy.draft, body.data.createdVia, body.data.confirmWidening === true, policy.baseCurrency);
    if (out.ok) {
      const res: MandateActivateResponse = { version: out.version, hash: out.hash, signedAt: out.signedAt, relation: out.relation };
      return Response.json(res, { status: 201 });
    }
    if (out.code === "widening_needs_review") {
      const res: MandateActivateConflict = {
        error: "this change gives Reins more permission; review it and sign again with confirmWidening",
        code: out.code,
        relation: out.relation,
        changes: out.changes,
      };
      return Response.json(res, { status: 409 });
    }
    if (out.code === "activation_conflict") return jsonError(409, "another change was signed at the same time; try again", out.code);
    return badBody(out.errors.join("; "));
  } catch (e) {
    console.error("[mandate/activate]", (e as Error).message);
    return jsonError(500, "internal_error");
  }
}
