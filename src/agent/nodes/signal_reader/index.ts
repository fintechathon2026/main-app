import type { SignalReaderPort } from "@/src/agent/deps";
import { buildSignalReaderGraph, type SignalReaderDeps } from "./graph";

export {
  buildSignalReaderGraph,
  SIGNAL_READER_NODE,
  SignalReaderInvalidOutput,
  type SignalReaderDeps,
} from "./graph";
export { SignalBundle, SignalWarningOutput, SignalWarningShape, type SignalFetcher } from "./schema";
export { createHttpSignalFetcher } from "./fetcher";
export { SIGNAL_READER_SYSTEM_PROMPT } from "./prompt";

/**
 * The Signal Reader as the agent sees it: a warning labeled origin=web, or null when there are
 * no signals. Never an action.
 */
export function createSignalReader(deps: SignalReaderDeps): SignalReaderPort {
  const graph = buildSignalReaderGraph(deps);
  return {
    async read(merchantId) {
      const result = await graph.invoke({ merchantId });
      return result.warning;
    },
  };
}
