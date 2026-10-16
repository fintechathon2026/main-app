// RecordedModelClient (architecture §6.5, §18.3): replays recorded responses for demo mode,
// CI and eval runs. Never calls the network. A cache miss throws loudly; it never falls back
// to a live model.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { chatKey, structuredKey, type Recording } from "./recording-key";
import type { ChatRequest, ChatResponse, ModelClient, StructuredRequest } from "./types";

export const RECORDINGS_ROOT = path.join(process.cwd(), "evals", "recordings");

export class RecordingMissError extends Error {
  constructor(
    readonly role: string,
    readonly key: string,
    readonly source: string,
  ) {
    super(
      `RecordedModelClient: no recording for role=${role} key=${key} in ${source}. ` +
        `Re-record this scenario with REINS_MODELS=recording, or check that the request ` +
        `(prompt, tools, messages) has not changed since it was recorded.`,
    );
    this.name = "RecordingMissError";
  }
}

export type RecordedModelClientOptions =
  | { recordings: Recording[]; source?: string }
  | { scenario: string; root?: string };

export function loadRecordings(dir: string): Recording[] {
  if (!existsSync(dir)) throw new Error(`RecordedModelClient: recordings directory not found: ${dir}`);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Recording);
}

export class RecordedModelClient implements ModelClient {
  private readonly byKey = new Map<string, Recording>();
  private readonly source: string;

  constructor(opts: RecordedModelClientOptions) {
    let recordings: Recording[];
    if ("recordings" in opts) {
      recordings = opts.recordings;
      this.source = opts.source ?? "inline recordings";
    } else {
      const dir = path.join(opts.root ?? RECORDINGS_ROOT, opts.scenario);
      recordings = loadRecordings(dir);
      this.source = dir;
    }
    for (const r of recordings) this.byKey.set(`${r.kind}:${r.key}`, r);
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const key = chatKey(req);
    const rec = this.byKey.get(`chat:${key}`);
    if (!rec || rec.kind !== "chat") throw new RecordingMissError(req.role, key, this.source);
    return structuredClone(rec.response);
  }

  async structured<T>(req: StructuredRequest<T>): Promise<T> {
    const key = structuredKey(req);
    const rec = this.byKey.get(`structured:${key}`);
    if (!rec || rec.kind !== "structured") throw new RecordingMissError(req.role, key, this.source);
    // Recordings are data too: validate exactly as a live response would be.
    return req.schema.parse(structuredClone(rec.response));
  }
}
