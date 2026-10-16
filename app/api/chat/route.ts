// POST /api/chat (architecture §13): one chat turn starts one plan. Streams newline-delimited
// ChatStreamEvent JSON. userId comes from the session, never the body. Approval cards are
// fetched from /api/approvals, never built from streamed LLM text.
// No `runtime` export: with cacheComponents on, Next.js 16 uses the Node.js runtime by default
// and rejects the `runtime` segment config.

import { z } from "zod";
import { startPlan } from "@/src/agent/run";
import type { ApiError, ChatStreamEvent } from "@/src/server/api-types";
import { getSessionUserId } from "@/src/server/auth/session";

const ChatBody = z
  .object({
    message: z.string().trim().min(1).max(4000),
    documentIds: z.array(z.uuid()).max(5).optional(),
  })
  .strict();

const error = (body: ApiError, status: number) => Response.json(body, { status });

export async function POST(request: Request): Promise<Response> {
  const userId = await getSessionUserId(request);
  if (!userId) return error({ error: "unauthorized" }, 401);

  let body: z.infer<typeof ChatBody>;
  try {
    body = ChatBody.parse(await request.json());
  } catch {
    return error({ error: "invalid body", code: "bad_request" }, 400);
  }

  const events = startPlan({ userId, trigger: "chat", subjectId: null, documentIds: body.documentIds, message: body.message });
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await events.next();
        if (next.done) return controller.close();
        controller.enqueue(encoder.encode(JSON.stringify(next.value satisfies ChatStreamEvent) + "\n"));
      } catch {
        const failed: ChatStreamEvent = { type: "error", message: "The agent run failed." };
        controller.enqueue(encoder.encode(JSON.stringify(failed) + "\n"));
        controller.close();
      }
    },
    async cancel() {
      await events.return(undefined);
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
