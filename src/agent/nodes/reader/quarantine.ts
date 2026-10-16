// Isolation checks shared by the Reader and Signal Reader subgraphs (architecture §4, Zone Q).
// A quarantined subgraph has no `messages` channel, binds no tools, and reaches the model only
// through `structured()` (which takes no tool list).

import type { ModelClient, StructuredRequest } from "@/src/agent/models/types";

export class QuarantineViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuarantineViolation";
  }
}

/** The only model capability a quarantined node gets: schema-constrained output, no tools. */
export type StructuredOnlyModel = { structured<T>(req: StructuredRequest<T>): Promise<T> };

export function structuredOnly(client: ModelClient): StructuredOnlyModel {
  return {
    structured<T>(req: StructuredRequest<T>) {
      // Rebuild the request so nothing beyond the declared fields (e.g. a smuggled `tools`
      // property) reaches the client.
      const clean: StructuredRequest<T> = {
        role: req.role,
        system: req.system,
        input: req.input,
        schema: req.schema,
        schemaName: req.schemaName,
        maxTokens: req.maxTokens,
      };
      return client.structured(clean);
    },
  };
}

type GraphLike = { nodes: Record<string, unknown>; channels: Record<string, unknown> };

const START_NODE = "__start__";

function looksLikeToolRunner(node: unknown): boolean {
  const bound = (node as { bound?: unknown } | null)?.bound;
  for (const candidate of [node, bound]) {
    if (!candidate || typeof candidate !== "object") continue;
    const ctor = (candidate as { constructor?: { name?: string } }).constructor?.name ?? "";
    if (/ToolNode|ToolExecutor/i.test(ctor)) return true;
    if (Array.isArray((candidate as { tools?: unknown }).tools)) return true;
  }
  return false;
}

/**
 * Throws unless the compiled graph is quarantined: only the expected nodes, no ToolNode, no
 * `messages` channel. Called at build time by both reader factories.
 */
export function assertQuarantinedGraph(graph: GraphLike, allowedNodes: readonly string[]): void {
  if ("messages" in graph.channels) {
    throw new QuarantineViolation("quarantined subgraph must not have a messages channel");
  }
  const allowed = new Set([START_NODE, ...allowedNodes]);
  for (const [name, node] of Object.entries(graph.nodes)) {
    if (!allowed.has(name)) throw new QuarantineViolation(`unexpected node in quarantined subgraph: ${name}`);
    if (looksLikeToolRunner(node)) throw new QuarantineViolation(`tool node in quarantined subgraph: ${name}`);
  }
}

// ---- Instruction-like text (anomaly signal, never an instruction) -------------------------

const INSTRUCTION_PATTERNS: RegExp[] = [
  /\bignore\s+(all\s+|any\s+|your\s+)?(previous|prior|above|earlier)?\s*(instructions|rules|prompts?)\b/i,
  /\bignore\s+your\s+rules\b/i,
  /\b(system|assistant|developer)\s*(override)?\s*:/i,
  /\bsystem\s+override\b/i,
  /\byou\s+are\s+now\b/i,
  /\b([Cc]all|[Ii]nvoke|[Tt]rigger)\s+(the\s+)?(tool\s+)?[a-z]+_[a-z_]+\b/,
  /\b(pay|transfer|send|refund|wire)\b[^.\n]{0,80}\bto\s+(this\s+|the\s+|new\s+)?(account|wallet|address)\b/i,
  /\b(approval|confirmation)\s+(is\s+)?(already\s+)?(granted|given|approved)\b/i,
  /\bskip\s+(the\s+)?confirmation\b/i,
  /\bdisable\s+(the\s+)?(policy|gate|limits?)\b/i,
  /\b(new|verified)\s+payee\b/i,
  /\bagents?\s+must\b/i,
  /\bAI\s+agent\b/i,
];

/** Code-side detector for instruction-like text. Used only as an anomaly flag. */
export function looksLikeInstructions(text: string): boolean {
  return INSTRUCTION_PATTERNS.some((re) => re.test(text));
}
