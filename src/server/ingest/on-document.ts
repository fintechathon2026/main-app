// Hook called once per newly ingested document. Integration replaces the body with the agent
// run (trigger with documentIds = [documentId]; the `reader` node calls the DocumentReaderPort).

import type { OnDocument } from "./upload";

export const onDocumentUploaded: OnDocument = async () => {
  // TODO(integration): start the plan run for this document.
};
