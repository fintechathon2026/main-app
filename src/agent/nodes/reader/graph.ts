// Reader subgraph (architecture §4 Zone Q, §6.3). One document at a time, no tools, no
// `messages` channel. Raw and redacted text live only inside the node, so they never land in
// graph state or a checkpoint; only labeled, zod-validated fields leave.

import { END, START, StateGraph, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { z } from "zod";
import type { Labeled } from "@/src/core/types";
import type { ModelClient } from "@/src/agent/models/types";
import { ReaderState, type ReaderStateT } from "@/src/agent/state";
import { redactPii, type PiiMap } from "@/src/server/pii/redact";
import { ReaderInvalidOutput, summarizeIssues } from "./errors";
import { extractDocument } from "./extract";
import { READER_SCHEMA_NAME, READER_SYSTEM_PROMPT, readerInput } from "./prompt";
import { assertQuarantinedGraph, looksLikeInstructions, structuredOnly } from "./quarantine";
import { BillExtraction, BillExtractionShape, type ReaderField } from "./schema";

export const READER_NODE = "read_document";

/** Upper bound on document text sent to the model (about 6k tokens). */
export const READER_MAX_INPUT_CHARS = 24_000;

export type LoadedDocument = { bytes: Uint8Array; mimeType: string };

export type ReaderDeps = {
  models: { reader: ModelClient };
  /** Loads the stored bytes for a document the user owns (user-scoped query). */
  loadDocument(documentId: string, userId: string): Promise<LoadedDocument>;
  /** Persists the token map server-side (architecture §10.2). Never passed to a model. */
  savePiiMap?(input: { documentId: string; userId: string; map: PiiMap }): Promise<void>;
  maxInputChars?: number;
};

const FIELD_ORDER = ["biller_name", "amount", "currency", "due_date", "period", "account_number", "suspicious_text"] as const;

function toLabeled(documentId: string, out: BillExtraction): Labeled<ReaderField>[] {
  const fields: Labeled<ReaderField>[] = [];
  for (const field of FIELD_ORDER) {
    const value = out[field];
    if (value === undefined || value === null) continue;
    fields.push({ value: { field, value }, origin: "document", sourceId: documentId });
  }
  return fields;
}

export function buildReaderGraph(deps: ReaderDeps) {
  const model = structuredOnly(deps.models.reader);
  const maxChars = deps.maxInputChars ?? READER_MAX_INPUT_CHARS;

  async function readDocument(state: ReaderStateT, config: LangGraphRunnableConfig): Promise<Partial<ReaderStateT>> {
    const documentId = state.documentId;
    const userId = config.configurable?.userId as string | undefined;
    if (!userId) throw new Error("reader: configurable.userId is required");

    const doc = await deps.loadDocument(documentId, userId);
    const extracted = await extractDocument(doc.bytes, doc.mimeType);
    if (!extracted) throw new ReaderInvalidOutput(documentId, "unsupported_type");
    const raw = extracted.text.trim();
    if (!raw) throw new ReaderInvalidOutput(documentId, "empty_text");

    // PII is tokenized before the call (T6); the map stays on the server.
    const { text: redacted, map } = redactPii(raw.slice(0, maxChars));
    if (deps.savePiiMap && Object.keys(map).length > 0) await deps.savePiiMap({ documentId, userId, map });

    let output: unknown;
    try {
      output = await model.structured({
        role: "reader",
        system: READER_SYSTEM_PROMPT,
        input: readerInput(redacted),
        schema: BillExtractionShape,
        schemaName: READER_SCHEMA_NAME,
        maxTokens: 512,
      });
    } catch (e) {
      if (e instanceof z.ZodError) throw new ReaderInvalidOutput(documentId, "schema", summarizeIssues(e.issues));
      throw e;
    }

    const parsed = BillExtraction.safeParse(output);
    if (!parsed.success) throw new ReaderInvalidOutput(documentId, "schema", summarizeIssues(parsed.error.issues));

    // Code-side anomaly signal: covers the full text and the metadata the model never sees.
    const heuristic = looksLikeInstructions(raw) || extracted.metadata.some(looksLikeInstructions);
    const out: BillExtraction = { ...parsed.data, suspicious_text: parsed.data.suspicious_text || heuristic };

    return { fields: toLabeled(documentId, out) };
  }

  const graph = new StateGraph(ReaderState)
    .addNode(READER_NODE, readDocument)
    .addEdge(START, READER_NODE)
    .addEdge(READER_NODE, END)
    .compile();

  assertQuarantinedGraph(graph, [READER_NODE]);
  return graph;
}
