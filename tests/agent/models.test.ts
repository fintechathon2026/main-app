import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AnthropicModelClient, modelIdsFromEnv } from "@/src/agent/models/anthropic";
import { createModelClients } from "@/src/agent/models";
import { RecordedModelClient, RecordingMissError } from "@/src/agent/models/recorded";
import { RecordingModelClient, directorySink } from "@/src/agent/models/recording";
import { chatKey, structuredKey, type Recording } from "@/src/agent/models/recording-key";
import type { ChatRequest, ChatResponse, ModelClient, StructuredRequest } from "@/src/agent/models/types";

const chatReq: ChatRequest = {
  role: "planner",
  system: "sys",
  messages: [{ role: "user", content: "pay my power bill" }],
};
const chatRes: ChatResponse = { text: "ok", toolCalls: [], stopReason: "end_turn" };
const schema = z.object({ amount: z.number().int().positive() }).strict();
const structReq: StructuredRequest<{ amount: number }> = {
  role: "reader",
  system: "extract",
  input: "doc text",
  schema,
  schemaName: "bill_fields_v1",
};

describe("recording keys", () => {
  it("are stable under key order and differ by role", () => {
    const reordered = { messages: chatReq.messages, system: "sys", role: "planner" } as ChatRequest;
    expect(chatKey(reordered)).toBe(chatKey(chatReq));
    expect(chatKey({ ...chatReq, role: "explainer" })).not.toBe(chatKey(chatReq));
  });

  it("replace the schema with schemaName", () => {
    const other = { ...structReq, schema: z.object({ x: z.string() }) } as unknown as StructuredRequest<{ amount: number }>;
    expect(structuredKey(other)).toBe(structuredKey(structReq));
    expect(structuredKey({ ...structReq, schemaName: "v2" })).not.toBe(structuredKey(structReq));
  });
});

describe("RecordedModelClient", () => {
  const recordings: Recording[] = [
    { kind: "chat", key: chatKey(chatReq), role: "planner", request: chatReq, response: chatRes },
    {
      kind: "structured",
      key: structuredKey(structReq),
      role: "reader",
      request: { ...structReq, schema: structReq.schemaName },
      response: { amount: 120 },
    },
  ];

  it("replays chat and structured recordings", async () => {
    const m = new RecordedModelClient({ recordings });
    await expect(m.chat(chatReq)).resolves.toEqual(chatRes);
    await expect(m.structured(structReq)).resolves.toEqual({ amount: 120 });
  });

  it("throws a clear error on a cache miss", async () => {
    const m = new RecordedModelClient({ recordings });
    const miss = { ...chatReq, messages: [{ role: "user" as const, content: "something else" }] };
    await expect(m.chat(miss)).rejects.toBeInstanceOf(RecordingMissError);
    await expect(m.chat(miss)).rejects.toThrow(/no recording for role=planner/);
    await expect(m.structured({ ...structReq, input: "other" })).rejects.toBeInstanceOf(RecordingMissError);
  });

  it("validates recorded structured output with zod", async () => {
    const bad: Recording = { ...(recordings[1] as Extract<Recording, { kind: "structured" }>), response: { amount: -1, extra: 1 } };
    const m = new RecordedModelClient({ recordings: [bad] });
    await expect(m.structured(structReq)).rejects.toThrow();
  });

  it("fails loudly when the scenario directory is missing", () => {
    expect(() => new RecordedModelClient({ scenario: "nope", root: path.join(tmpdir(), "reins-none") })).toThrow(/not found/);
  });
});

describe("RecordingModelClient", () => {
  it("writes recordings that RecordedModelClient replays", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "reins-rec-"));
    const live: ModelClient = {
      chat: async () => chatRes,
      structured: async <T,>() => ({ amount: 7 }) as T,
    };
    const rec = new RecordingModelClient(live, directorySink("s1", root));
    await rec.chat(chatReq);
    await rec.structured(structReq);
    expect(readdirSync(path.join(root, "s1"))).toHaveLength(2);

    const replay = new RecordedModelClient({ scenario: "s1", root });
    await expect(replay.chat(chatReq)).resolves.toEqual(chatRes);
    await expect(replay.structured(structReq)).resolves.toEqual({ amount: 7 });
  });
});

describe("createModelClients", () => {
  it("rejects unknown modes", () => {
    expect(() => createModelClients("yolo")).toThrow(/REINS_MODELS/);
  });

  it("reads model IDs from env with the documented defaults", () => {
    expect(modelIdsFromEnv({})).toEqual({
      planner: "claude-sonnet-5-5",
      reader: "claude-haiku-5-5",
      signal_reader: "claude-haiku-5-5",
      explainer: "claude-haiku-5-5",
      mandate_compiler: "claude-sonnet-5-5",
    });
    expect(modelIdsFromEnv({ REINS_READER_MODEL: "r" }).signal_reader).toBe("r");
  });
});

describe("AnthropicModelClient", () => {
  function fakeSdk(content: unknown[], stop = "tool_use") {
    const create = vi.fn(async () => ({
      content,
      stop_reason: stop,
      usage: { input_tokens: 1, output_tokens: 2 },
    }));
    return { sdk: { messages: { create } } as unknown as Anthropic, create };
  }

  it("maps tool calls out and merges tool results into one user turn, replaying thinking blocks", async () => {
    const { sdk, create } = fakeSdk([
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "tool_use", id: "t1", name: "list_bills", input: {}, caller: { type: "direct" } },
      { type: "tool_use", id: "t2", name: "pay_bill", input: { bill_id: "b" }, caller: { type: "direct" } },
    ]);
    const m = new AnthropicModelClient(modelIdsFromEnv({}), sdk);
    const res = await m.chat({
      ...chatReq,
      tools: [{ name: "list_bills", description: "d", inputSchema: { $schema: "x", type: "object", properties: {} } }],
    });
    expect(res.stopReason).toBe("tool_use");
    expect(res.toolCalls.map((c) => c.name)).toEqual(["list_bills", "pay_bill"]);
    const firstCall = create.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(firstCall[0].model).toBe("claude-sonnet-5-5");
    expect((firstCall[0].tools as { input_schema: Record<string, unknown> }[])[0].input_schema).not.toHaveProperty("$schema");

    await m.chat({
      ...chatReq,
      messages: [
        ...chatReq.messages,
        { role: "assistant", content: res.text, toolCalls: res.toolCalls },
        { role: "tool", toolCallId: "t2", content: '{"status":"queued_for_review"}' },
        { role: "tool", toolCallId: "t1", content: "[]" },
      ],
    });
    const second = (create.mock.calls[1] as unknown as [{ messages: Anthropic.MessageParam[] }])[0].messages;
    expect(second).toHaveLength(3);
    expect((second[1].content as Anthropic.ContentBlockParam[])[0]).toEqual({ type: "thinking", thinking: "", signature: "sig" });
    expect((second[2].content as Anthropic.ContentBlockParam[]).map((b) => b.type)).toEqual(["tool_result", "tool_result"]);
  });
});
