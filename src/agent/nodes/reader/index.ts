import type { DocumentReaderPort } from "@/src/agent/deps";
import { buildReaderGraph, type ReaderDeps } from "./graph";

export { buildReaderGraph, READER_NODE, READER_MAX_INPUT_CHARS, type ReaderDeps, type LoadedDocument } from "./graph";
export { ReaderInvalidOutput, type ReaderFailureReason } from "./errors";
export { BillExtraction, BillExtractionShape, type ReaderField, type BillFieldName } from "./schema";
export { READER_SYSTEM_PROMPT } from "./prompt";
export { assertQuarantinedGraph, QuarantineViolation } from "./quarantine";

/**
 * The Reader as the agent sees it. Throws `ReaderInvalidOutput` when the document cannot be
 * read into the schema; the caller marks the document needs_review and creates no bill.
 */
export function createDocumentReader(deps: ReaderDeps): DocumentReaderPort {
  const graph = buildReaderGraph(deps);
  return {
    async read(documentId, userId) {
      const result = await graph.invoke({ documentId }, { configurable: { userId } });
      return result.fields;
    },
  };
}
