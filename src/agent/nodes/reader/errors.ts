// Typed Reader failures. The caller marks the document `needs_review` and creates no bill.

export type ReaderFailureReason = "schema" | "empty_text" | "unsupported_type";

export class ReaderInvalidOutput extends Error {
  readonly documentId: string;
  readonly reason: ReaderFailureReason;
  /** zod issue paths and codes only; never values (they are untrusted text). */
  readonly issues: string[];

  constructor(documentId: string, reason: ReaderFailureReason, issues: string[] = []) {
    super(`reader output rejected for document ${documentId}: ${reason}`);
    this.name = "ReaderInvalidOutput";
    this.documentId = documentId;
    this.reason = reason;
    this.issues = issues;
  }
}

export function summarizeIssues(issues: readonly { path: PropertyKey[]; code: string }[]): string[] {
  return issues.map((i) => `${i.path.map(String).join(".") || "(root)"}:${i.code}`);
}
