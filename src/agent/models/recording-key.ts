// Recording keys and file format shared by RecordedModelClient and RecordingModelClient
// (architecture §6.5). Key = sha256(role + canonical JSON of the request), where a structured
// request's zod schema is replaced by its schemaName so the key is stable and serializable.

import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import type { ChatRequest, ChatResponse, ModelRole, StructuredRequest } from "./types";

export type RecordedChat = {
  kind: "chat";
  key: string;
  role: ModelRole;
  request: ChatRequest;
  response: ChatResponse;
};

export type RecordedStructured = {
  kind: "structured";
  key: string;
  role: ModelRole;
  request: Omit<StructuredRequest<unknown>, "schema"> & { schema: string };
  response: unknown;
};

export type Recording = RecordedChat | RecordedStructured;

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function canonical(value: unknown): string {
  const out = canonicalize(value);
  if (out === undefined) throw new Error("recording key: request is not JSON-serializable");
  return out;
}

export function chatKey(req: ChatRequest): string {
  return sha256(req.role + canonical(req));
}

/** The serializable form of a structured request: the schema is replaced by its name. */
export function structuredRequestForKey<T>(req: StructuredRequest<T>): RecordedStructured["request"] {
  return { ...req, schema: req.schemaName };
}

export function structuredKey<T>(req: StructuredRequest<T>): string {
  return sha256(req.role + canonical(structuredRequestForKey(req)));
}

/** File name for a recording inside evals/recordings/<scenario>/. */
export function recordingFileName(rec: Recording): string {
  return `${rec.role}-${rec.key.slice(0, 16)}.json`;
}
