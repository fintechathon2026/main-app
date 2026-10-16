// A ModelClient spy: delegates to another client and keeps a copy of every request, so tests can
// assert exactly what reached "the model" (PRD §11.6.2 canary checks).

import type { ChatRequest, ChatResponse, ModelClient, StructuredRequest } from "@/src/agent/models/types";

export type CapturedStructured = Omit<StructuredRequest<unknown>, "schema"> & { schemaKeys: string[] };

export class CapturingModelClient implements ModelClient {
  readonly chats: ChatRequest[] = [];
  readonly structureds: CapturedStructured[] = [];
  /** Raw structured requests as received (to check that no extra fields such as tools leak in). */
  readonly rawStructuredKeys: string[][] = [];

  constructor(private readonly inner: ModelClient) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.chats.push(structuredClone(req));
    return this.inner.chat(req);
  }

  async structured<T>(req: StructuredRequest<T>): Promise<T> {
    this.rawStructuredKeys.push(Object.keys(req).sort());
    const { schema, ...rest } = req;
    const shape = (schema as unknown as { shape?: Record<string, unknown> }).shape;
    this.structureds.push({ ...structuredClone(rest), schemaKeys: Object.keys(shape ?? {}).sort() });
    return this.inner.structured(req);
  }

  chatsFor(role: ChatRequest["role"]): ChatRequest[] {
    return this.chats.filter((r) => r.role === role);
  }

  reset() {
    this.chats.length = 0;
    this.structureds.length = 0;
    this.rawStructuredKeys.length = 0;
  }
}
