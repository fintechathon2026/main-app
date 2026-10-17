// ModelClient interface (architecture §6.5). Owner: R1. Consumers: graph nodes, eval runner (R2).
// Implementations: AnthropicModelClient (live), RecordedModelClient (demo/CI/eval),
// RecordingModelClient (wraps live, writes recordings). Injected via `configurable.models`.

import type { z } from "zod";

export type ModelRole = "planner" | "reader" | "signal_reader" | "explainer" | "mandate_compiler";

export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export type ToolCall = { id: string; name: string; args: Record<string, unknown> };

export type ToolSpec = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
};

export type ChatRequest = {
  role: ModelRole;
  system: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  maxTokens?: number;
};

export type ChatResponse = {
  text: string;
  toolCalls: ToolCall[];
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "refusal" | "other";
  usage?: { inputTokens: number; outputTokens: number };
};

export type StructuredRequest<T> = {
  role: ModelRole;
  system: string;
  input: string;
  schema: z.ZodType<T>;
  schemaName: string;
  maxTokens?: number;
};

export interface ModelClient {
  chat(req: ChatRequest): Promise<ChatResponse>;
  structured<T>(req: StructuredRequest<T>): Promise<T>;
}

export type ModelMode = "live" | "recorded" | "recording";
