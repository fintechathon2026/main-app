// AnthropicModelClient (architecture §0.3, §6.5): the live implementation of ModelClient over
// @anthropic-ai/sdk 0.135.0.
//
// - chat(): Messages API with client tools. Tool calls come back as plain data; this client
//   never executes anything.
// - structured(): structured outputs via `messages.parse` + `zodOutputFormat` (output_config.
//   format, constrained decoding). Forced tool use is not used: tool_choice any/tool returns a
//   400 on the current Sonnet. The result is validated with zod again here, because structured
//   outputs ignore numeric min/max and string length constraints (architecture §0.3).

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ChatMessage, ChatRequest, ChatResponse, ModelClient, ModelRole, StructuredRequest, ToolCall } from "./types";

export type ModelIds = Record<ModelRole, string>;

export function modelIdsFromEnv(env: Record<string, string | undefined> = process.env): ModelIds {
  const planner = env.REINS_PLANNER_MODEL || "claude-sonnet-5-5";
  const reader = env.REINS_READER_MODEL || "claude-haiku-5-5";
  const explainer = env.REINS_EXPLAINER_MODEL || "claude-haiku-5-5";
  return { planner, reader, signal_reader: reader, explainer, mandate_compiler: planner };
}

const DEFAULT_MAX_TOKENS = 16000;
const RAW_CACHE_LIMIT = 500;

export class ModelRefusalError extends Error {
  constructor(role: ModelRole, detail?: string) {
    super(`model refused the ${role} request${detail ? `: ${detail}` : ""}`);
    this.name = "ModelRefusalError";
  }
}

export class StructuredOutputError extends Error {
  constructor(role: ModelRole, reason: string) {
    super(`structured output for ${role} failed: ${reason}`);
    this.name = "StructuredOutputError";
  }
}

export class AnthropicModelClient implements ModelClient {
  private readonly client: Anthropic;
  /**
   * Assistant turns as the API returned them (including thinking blocks), keyed by the
   * ChatMessage they were mapped to. Current models require thinking blocks to be passed back
   * unchanged inside a tool-use loop, but the shared ChatMessage type has no field for them, so
   * they are kept here for the life of the process (one planner loop runs in one request).
   * TODO(contracts): add an opaque `providerBlocks` field to assistant ChatMessage.
   */
  private readonly rawAssistant = new Map<string, Anthropic.ContentBlockParam[]>();

  constructor(
    private readonly models: ModelIds = modelIdsFromEnv(),
    client?: Anthropic,
  ) {
    this.client = client ?? new Anthropic();
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const res = await this.client.messages.create({
      model: this.models[req.role],
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: req.system,
      messages: this.toParams(req.messages),
      ...(req.tools?.length
        ? {
            tools: req.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: toInputSchema(t.inputSchema),
            })),
          }
        : {}),
    });

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const toolCalls: ToolCall[] = res.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
      .map((b) => ({ id: b.id, name: b.name, args: isRecord(b.input) ? b.input : {} }));

    this.remember({ role: "assistant", content: text, toolCalls: toolCalls.length ? toolCalls : undefined }, res.content);

    return {
      text,
      toolCalls,
      stopReason: mapStopReason(res.stop_reason),
      usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
    };
  }

  async structured<T>(req: StructuredRequest<T>): Promise<T> {
    const res = await this.client.messages.parse({
      model: this.models[req.role],
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: req.system,
      messages: [{ role: "user", content: req.input }],
      output_config: { format: zodOutputFormat(req.schema) },
    });
    if (res.stop_reason === "refusal") throw new ModelRefusalError(req.role, res.stop_details?.category ?? undefined);
    if (res.stop_reason === "max_tokens") throw new StructuredOutputError(req.role, "max_tokens reached");
    if (res.parsed_output == null) throw new StructuredOutputError(req.role, "no parsed output");
    // Always validate with zod, independent of the SDK helper.
    return req.schema.parse(res.parsed_output);
  }

  private toParams(messages: ChatMessage[]): Anthropic.MessageParam[] {
    const out: Anthropic.MessageParam[] = [];
    for (const m of messages) {
      if (m.role === "user") {
        out.push({ role: "user", content: m.content });
      } else if (m.role === "assistant") {
        const raw = this.rawAssistant.get(fingerprint(m));
        if (raw) {
          out.push({ role: "assistant", content: raw });
          continue;
        }
        const blocks: Anthropic.ContentBlockParam[] = [];
        if (m.content) blocks.push({ type: "text", text: m.content });
        for (const c of m.toolCalls ?? []) blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.args });
        out.push({ role: "assistant", content: blocks.length ? blocks : m.content });
      } else {
        // All tool results for one assistant turn must arrive in a single user message.
        const block: Anthropic.ToolResultBlockParam = { type: "tool_result", tool_use_id: m.toolCallId, content: m.content };
        const last = out[out.length - 1];
        if (last && last.role === "user" && Array.isArray(last.content) && last.content.every((b) => b.type === "tool_result")) {
          last.content.push(block);
        } else {
          out.push({ role: "user", content: [block] });
        }
      }
    }
    return out;
  }

  private remember(msg: ChatMessage, content: Anthropic.ContentBlock[]) {
    const params: Anthropic.ContentBlockParam[] = [];
    for (const b of content) {
      if (b.type === "text") params.push({ type: "text", text: b.text });
      else if (b.type === "thinking") params.push({ type: "thinking", thinking: b.thinking, signature: b.signature });
      else if (b.type === "redacted_thinking") params.push({ type: "redacted_thinking", data: b.data });
      else if (b.type === "tool_use") params.push({ type: "tool_use", id: b.id, name: b.name, input: b.input });
    }
    if (this.rawAssistant.size >= RAW_CACHE_LIMIT) {
      const oldest = this.rawAssistant.keys().next().value;
      if (oldest !== undefined) this.rawAssistant.delete(oldest);
    }
    this.rawAssistant.set(fingerprint(msg), params);
  }
}

function fingerprint(m: ChatMessage): string {
  if (m.role !== "assistant") return "";
  return JSON.stringify([m.content, (m.toolCalls ?? []).map((c) => [c.id, c.name, c.args])]);
}

function toInputSchema(schema: Record<string, unknown>): Anthropic.Tool.InputSchema {
  // zod's toJSONSchema adds "$schema"; the tool definition only needs the schema body.
  const { $schema: _drop, ...rest } = schema;
  void _drop;
  return { ...rest, type: "object" };
}

function mapStopReason(r: Anthropic.StopReason | null): ChatResponse["stopReason"] {
  switch (r) {
    case "end_turn":
    case "tool_use":
    case "max_tokens":
    case "refusal":
      return r;
    default:
      return "other";
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
