// RecordingModelClient (architecture §6.5): wraps a live client and writes every exchange as a
// recording, so a scenario can later replay through RecordedModelClient.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  chatKey,
  recordingFileName,
  structuredKey,
  structuredRequestForKey,
  type Recording,
} from "./recording-key";
import { RECORDINGS_ROOT } from "./recorded";
import type { ChatRequest, ChatResponse, ModelClient, StructuredRequest } from "./types";

/** Where recordings go. The default writes JSON files to evals/recordings/<scenario>/. */
export type RecordingSink = (rec: Recording) => void;

export function directorySink(scenario: string, root = RECORDINGS_ROOT): RecordingSink {
  const dir = path.join(root, scenario);
  return (rec) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, recordingFileName(rec)), JSON.stringify(rec, null, 2) + "\n");
  };
}

export class RecordingModelClient implements ModelClient {
  constructor(
    private readonly inner: ModelClient,
    private readonly sink: RecordingSink,
  ) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const response = await this.inner.chat(req);
    this.sink({ kind: "chat", key: chatKey(req), role: req.role, request: req, response });
    return response;
  }

  async structured<T>(req: StructuredRequest<T>): Promise<T> {
    const response = await this.inner.structured(req);
    this.sink({
      kind: "structured",
      key: structuredKey(req),
      role: req.role,
      request: structuredRequestForKey(req),
      response,
    });
    return response;
  }
}
