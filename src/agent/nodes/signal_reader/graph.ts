// Signal Reader subgraph (architecture §6.3, PRD §11.1, T25). Same isolation as the Reader:
// no tools, no `messages` channel, structured output only. Its output is a warning labeled
// origin=web; it can raise a feed warning and the advisor's risk parameter, never an action.

import { END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import type { Labeled } from "@/src/core/types";
import type { ModelClient } from "@/src/agent/models/types";
import { SignalReaderState, type SignalReaderStateT, type SignalWarning } from "@/src/agent/state";
import { redactPii, type PiiMap } from "@/src/server/pii/redact";
import { summarizeIssues } from "@/src/agent/nodes/reader/errors";
import { assertQuarantinedGraph, structuredOnly } from "@/src/agent/nodes/reader/quarantine";
import { SIGNAL_READER_SCHEMA_NAME, SIGNAL_READER_SYSTEM_PROMPT, signalReaderInput } from "./prompt";
import { SignalBundle, SignalWarningOutput, SignalWarningShape, type SignalFetcher } from "./schema";

export const SIGNAL_READER_NODE = "read_signals";

export class SignalReaderInvalidOutput extends Error {
  readonly merchantId: string;
  readonly reason: "input" | "schema";
  readonly issues: string[];

  constructor(merchantId: string, reason: "input" | "schema", issues: string[] = []) {
    super(`signal reader ${reason} rejected for merchant ${merchantId}`);
    this.name = "SignalReaderInvalidOutput";
    this.merchantId = merchantId;
    this.reason = reason;
    this.issues = issues;
  }
}

export type SignalReaderDeps = {
  models: { signal_reader: ModelClient };
  fetchSignals: SignalFetcher;
};

function redactBundle(bundle: SignalBundle) {
  let map: PiiMap = {};
  const r = (s: string) => {
    const out = redactPii(s, map);
    map = out.map;
    return out.text;
  };
  const payload = {
    merchantId: bundle.merchantId,
    complaints: bundle.complaints.map((c) => ({ sourceId: c.sourceId, date: c.date, count: c.count, text: r(c.text) })),
    news: bundle.news.map((n) => ({ sourceId: n.sourceId, publishedAt: n.publishedAt, title: r(n.title), snippet: r(n.snippet) })),
  };
  return payload;
}

export function buildSignalReaderGraph(deps: SignalReaderDeps) {
  const model = structuredOnly(deps.models.signal_reader);

  async function readSignals(state: SignalReaderStateT): Promise<Partial<SignalReaderStateT>> {
    const merchantId = state.merchantId;
    const fetched = SignalBundle.safeParse(await deps.fetchSignals(merchantId));
    if (!fetched.success) throw new SignalReaderInvalidOutput(merchantId, "input", summarizeIssues(fetched.error.issues));
    const bundle = fetched.data;
    if (bundle.merchantId !== merchantId) throw new SignalReaderInvalidOutput(merchantId, "input", ["merchantId:mismatch"]);
    if (bundle.complaints.length === 0 && bundle.news.length === 0) return { warning: null };

    // URLs are dropped and PII/wallets tokenized before the call.
    const payload = redactBundle(bundle);

    let output: unknown;
    try {
      output = await model.structured({
        role: "signal_reader",
        system: SIGNAL_READER_SYSTEM_PROMPT,
        input: signalReaderInput(payload),
        schema: SignalWarningShape,
        schemaName: SIGNAL_READER_SCHEMA_NAME,
        maxTokens: 400,
      });
    } catch (e) {
      if (e instanceof z.ZodError) throw new SignalReaderInvalidOutput(merchantId, "schema", summarizeIssues(e.issues));
      throw e;
    }
    const parsed = SignalWarningOutput.safeParse(output);
    if (!parsed.success) throw new SignalReaderInvalidOutput(merchantId, "schema", summarizeIssues(parsed.error.issues));

    // Code decides what leaves: only known source ids, and a summary with any wallet, account
    // or phone number re-tokenized (the model may echo them from its training or the input).
    const known = new Set([...bundle.complaints, ...bundle.news].map((s) => s.sourceId));
    const warning: SignalWarning = {
      level: parsed.data.level,
      summary: redactPii(parsed.data.summary).text,
      sourceIds: [...new Set(parsed.data.sourceIds.filter((id) => known.has(id)))],
    };
    const labeled: Labeled<SignalWarning> = { value: warning, origin: "web", sourceId: merchantId };
    return { warning: labeled };
  }

  const graph = new StateGraph(SignalReaderState)
    .addNode(SIGNAL_READER_NODE, readSignals)
    .addEdge(START, SIGNAL_READER_NODE)
    .addEdge(SIGNAL_READER_NODE, END)
    .compile();

  assertQuarantinedGraph(graph, [SIGNAL_READER_NODE]);
  return graph;
}
