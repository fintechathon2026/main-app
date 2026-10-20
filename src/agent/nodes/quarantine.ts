// Graph nodes that call the quarantined Reader and Signal Reader through their injected ports
// (architecture §6.3, H5). The subgraphs themselves live in nodes/reader and
// nodes/signal_reader; this graph only receives their labeled output. Labels are enforced here
// as well: a port can never upgrade untrusted content to a trusted origin.

import { UNTRUSTED_ORIGINS, type Labeled, type Origin } from "@/src/core/types";
import type { NodeFn } from "./graph-state";
import { ReaderInvalidOutput } from "./reader/errors";
import { SignalReaderInvalidOutput } from "./signal_reader";
import { getDeps } from "./graph-state";

function keepUntrusted<T>(item: Labeled<T>, fallback: Origin, sourceId: string): Labeled<T> {
  const origin = UNTRUSTED_ORIGINS.includes(item.origin) ? item.origin : fallback;
  return { value: item.value, origin, sourceId: item.sourceId ?? sourceId };
}

/** Node "reader": every field from every referenced document, labeled untrusted. */
export const readDocuments: NodeFn = async (state, config) => {
  const { reader } = getDeps(config);
  const extracted: Labeled<unknown>[] = [];
  for (const documentId of state.documentIds) {
    let fields: Labeled<unknown>[];
    try {
      fields = await reader.read(documentId, state.userId);
    } catch (e) {
      if (!(e instanceof ReaderInvalidOutput)) throw e;
      // Unreadable document: the plan continues without its fields and the user is told to review.
      await reader.markStatus(documentId, state.userId, "needs_review");
      continue;
    }
    await reader.markStatus(documentId, state.userId, "parsed");
    for (const f of fields) extracted.push(keepUntrusted(f, "document", documentId));
  }
  return { extracted };
};

/**
 * Node "signal_reader" (trigger prepaid_risk): subjectId is the prepaid plan id; the merchant is
 * resolved from the user's own plan row, then the Signal Reader returns a warning for it.
 */
export const readSignals: NodeFn = async (state, config) => {
  const { signalReader, store } = getDeps(config);
  if (!state.subjectId) return {};
  const merchantId = await store.prepaidPlanMerchant(state.subjectId, state.userId);
  if (!merchantId) return {};
  let warning: Awaited<ReturnType<typeof signalReader.read>>;
  try {
    warning = await signalReader.read(merchantId);
  } catch (e) {
    if (!(e instanceof SignalReaderInvalidOutput)) throw e;
    // Soft signals only ever warn. An unreadable answer drops the warning, never the plan: an
    // attested exit rests on the oracle-signed attestation the Gate re-verifies, not on this text.
    return {};
  }
  if (!warning) return {};
  return { warnings: [keepUntrusted(warning, "web", merchantId)] };
};
