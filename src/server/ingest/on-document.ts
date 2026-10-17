// Hook called once per newly ingested document: starts a plan whose `reader` node runs the
// quarantined Reader on it (architecture §10.1, §14.2). Trigger "document" with the document as
// subject, so one document has at most one running plan.

import type { OnDocument } from "./upload";

export const onDocumentUploaded: OnDocument = async (documentId, userId) => {
  const { startPlan } = await import("@/src/agent/run");
  for await (const ev of startPlan({ userId, trigger: "document", subjectId: documentId, documentIds: [documentId] })) {
    if (ev.type === "error") throw new Error(ev.message);
  }
};
