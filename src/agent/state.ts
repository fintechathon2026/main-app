// Graph state (architecture §6.2). Planner state holds pointers and labeled values only.
// Reader and Signal Reader states are disjoint: no `messages` channel, so raw untrusted
// text can never flow into the Planner's context (H5).

import { Annotation } from "@langchain/langgraph";
import type { Labeled, Trigger } from "@/src/core/types";
import type { ChatMessage, ToolCall } from "./models/types";

const append = <T>(a: T[], b: T[] | T) => a.concat(b);
const replace = <T>(_a: T, b: T) => b;

/** A side-effecting tool call exactly as the LLM produced it. Untrusted until persist_plan. */
export type ProposedCall = Pick<ToolCall, "name" | "args">;

export type Route = "execute" | "approve" | "deny" | "none";

export const PlannerState = Annotation.Root({
  userId: Annotation<string>(), // set only by the route handler, from the session
  planId: Annotation<string>(), // = thread_id; set only by the route handler
  trigger: Annotation<Trigger>(),
  subjectId: Annotation<string | null>({ reducer: replace, default: () => null }),
  documentIds: Annotation<string[]>({ reducer: replace, default: () => [] }),
  mandateVersion: Annotation<number | null>({ reducer: replace, default: () => null }),
  mandateHash: Annotation<string | null>({ reducer: replace, default: () => null }),
  killSwitch: Annotation<boolean>({ reducer: replace, default: () => false }),
  messages: Annotation<ChatMessage[]>({ reducer: append, default: () => [] }),
  extracted: Annotation<Labeled<unknown>[]>({ reducer: append, default: () => [] }),
  warnings: Annotation<Labeled<unknown>[]>({ reducer: append, default: () => [] }),
  proposed: Annotation<ProposedCall[]>({ reducer: append, default: () => [] }),
  actionIds: Annotation<string[]>({ reducer: replace, default: () => [] }),
  route: Annotation<Route>({ reducer: replace, default: () => "none" }),
  approvalId: Annotation<string | null>({ reducer: replace, default: () => null }),
  replanCount: Annotation<number>({ reducer: replace, default: () => 0 }),
  feed: Annotation<string[]>({ reducer: append, default: () => [] }),
});
export type PlannerStateT = typeof PlannerState.State;

export const ReaderState = Annotation.Root({
  documentId: Annotation<string>(),
  fields: Annotation<Labeled<unknown>[]>({ reducer: replace, default: () => [] }),
});
export type ReaderStateT = typeof ReaderState.State;

export const SignalReaderState = Annotation.Root({
  merchantId: Annotation<string>(),
  warning: Annotation<Labeled<SignalWarning> | null>({ reducer: replace, default: () => null }),
});
export type SignalReaderStateT = typeof SignalReaderState.State;

export type SignalWarning = {
  level: "none" | "watch" | "elevated";
  summary: string;
  sourceIds: string[];
};
