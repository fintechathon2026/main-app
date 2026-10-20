// Owner: R2 (roles.md).
// POST /api/mandates/compile (architecture §9.1, §13): the user's words in, a draft policy and its
// read-back out. The compiler only drafts: nothing is saved, signed or activated here (G6), and
// the read-back is generated from the policy by templates. Body is exactly {text}; the user comes
// from the session. REINS_FIXTURES=1 serves fixtures/api/mandates-compile.json for any valid body.
// With REINS_MODELS=recorded (the default) only texts that were recorded can be compiled; any other
// text answers 503 model_unavailable. `relation` and `changes` compare the draft with the active
// mandate (compareMandates, src/core/mandate/narrow.ts) so the sheet can show the diff.
// No `runtime` export: cacheComponents is on, and Node is the default runtime.

import { connection } from "next/server";
import { z } from "zod";
import { RecordingMissError, createModelClients } from "@/src/agent/models";
import fixture from "@/fixtures/api/mandates-compile.json";
import type { MandateCompileResponse } from "@/src/server/api-types";
import { fixturesEnabled, jsonError, readRoute } from "@/src/server/db/read/http";
import { loadActiveMandate } from "@/src/server/db/read/mandate-repo";
import { classifyChange, toStoredPolicy } from "@/src/server/mandate/activate";
import { MAX_MANDATE_TEXT, MandateCompileError, compile } from "@/src/server/mandate/compile";

const Body = z.strictObject({ text: z.string().min(1).max(MAX_MANDATE_TEXT) });
const badBody = () => jsonError(400, `body must be {text: string, 1 to ${MAX_MANDATE_TEXT} characters}`, "bad_request");

/** 4000 characters of text is at most 16000 bytes of UTF-8, so 16 KiB covers every valid body. */
const MAX_BODY_BYTES = 16 * 1024;
const tooLarge = () => jsonError(413, `body must be at most ${MAX_BODY_BYTES} bytes`, "payload_too_large");

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

let models: ReturnType<typeof createModelClients> | null = null;

export async function POST(req: Request): Promise<Response> {
  if (fixturesEnabled()) {
    await connection();
    const raw = await readJson(req);
    if (raw instanceof Response) return raw;
    return Body.safeParse(raw.value).success ? Response.json(fixture as MandateCompileResponse) : badBody();
  }
  return readRoute<MandateCompileResponse>(
    req,
    () => fixture as MandateCompileResponse,
    async (d) => {
      const raw = await readJson(req);
      if (raw instanceof Response) return raw;
      const body = Body.safeParse(raw.value);
      if (!body.success) return badBody();
      const base = (await d.repos.settings(d.userId)).baseCurrency;
      if (base !== "CNY" && base !== "IDR") throw new Error(`unsupported base currency ${base}`);
      try {
        models ??= createModelClients();
        const r = await compile(body.data.text, { models, baseCurrency: base });
        // The diff the sheet shows before signing. Activation recomputes it under its lock.
        const active = await loadActiveMandate(d.userId);
        const stored = toStoredPolicy(r.policy, (active?.version ?? 0) + 1);
        if (!stored.ok) return jsonError(422, `compiled policy is not valid: ${stored.errors.join("; ")}`, "compile_failed");
        const { relation, changes } = classifyChange(active?.policy ?? null, stored.policy);
        return { baseCurrency: base, policy: r.policy, defaulted: r.defaulted, readback: r.readback, relation, changes };
      } catch (e) {
        if (e instanceof MandateCompileError) return jsonError(422, e.message, "compile_failed");
        if (e instanceof RecordingMissError) return jsonError(503, "no recorded model answer for this text", "model_unavailable");
        throw e;
      }
    },
  );
}
