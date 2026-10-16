import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChatRequest, ChatResponse, ModelClient, StructuredRequest } from "@/src/agent/models/types";

export const ROOT = join(__dirname, "..", "..");

export function fixtureBytes(path: string): Uint8Array {
  return new Uint8Array(readFileSync(join(ROOT, path)));
}

export function fixtureJson<T>(path: string): T {
  return JSON.parse(readFileSync(join(ROOT, path), "utf8")) as T;
}

/**
 * Fake ModelClient: returns canned structured outputs and records every request so tests can
 * assert what reached "the model". `chat` must never be called by a quarantined reader.
 */
export class FakeModelClient implements ModelClient {
  readonly structuredCalls: StructuredRequest<unknown>[] = [];
  readonly chatCalls: ChatRequest[] = [];

  constructor(private readonly respond: (req: StructuredRequest<unknown>) => unknown) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.chatCalls.push(req);
    throw new Error("chat() must not be called from a quarantined subgraph");
  }

  async structured<T>(req: StructuredRequest<T>): Promise<T> {
    this.structuredCalls.push(req as StructuredRequest<unknown>);
    return this.respond(req as StructuredRequest<unknown>) as T;
  }

  /** Everything the model was sent, as one string. */
  seen(): string {
    return this.structuredCalls.map((r) => JSON.stringify({ ...r, schema: undefined })).join("\n");
  }
}
