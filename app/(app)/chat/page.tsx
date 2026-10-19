"use client";

// Chat (architecture §13, §15.2). Reads the NDJSON ChatStreamEvent stream from /api/chat. When
// the plan pauses for approval, the card is loaded from /api/approvals, never from streamed text.

import { useEffect, useRef, useState } from "react";
import type { ApprovalsResponse, DecisionResponse } from "@/app/api/approvals/_lib/cards";
import type { ChatStreamEvent } from "@/src/server/api-types";
import { ApprovalCardView } from "../../_components/approval-card";
import { Badge, Button } from "../../_components/ui";
import { apiFetch, apiHeaders } from "../../_lib/api";

type Msg =
  | { id: string; role: "user"; text: string; attachment?: string }
  | { id: string; role: "agent"; text: string; status?: string; feed: string[]; approvalId?: string; done?: boolean; error?: string };

const SUGGESTIONS = [
  "Pay my electricity bill",
  "Which subscriptions should I cancel?",
  "Is my FitBox package still safe?",
  "What do I owe in the next two weeks?",
];

let seq = 0;
const nextId = () => `m${++seq}`;

export default function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [messages]);

  // Prefill from ?prompt= (links from other screens). Prefill only: the user still sends it.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("prompt");
    if (p) setInput(p.slice(0, 4000));
  }, []);

  const patchAgent = (id: string, fn: (m: Extract<Msg, { role: "agent" }>) => Extract<Msg, { role: "agent" }>) =>
    setMessages((ms) => ms.map((m) => (m.id === id && m.role === "agent" ? fn(m) : m)));

  async function send(text: string) {
    const message = text.trim();
    if (!message || running) return;
    setRunning(true);
    setInput("");
    const attachment = file;
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";

    const agentId = nextId();
    setMessages((ms) => [
      ...ms,
      { id: nextId(), role: "user", text: message, attachment: attachment?.name },
      { id: agentId, role: "agent", text: "", feed: [] },
    ]);

    try {
      let documentIds: string[] | undefined;
      if (attachment) {
        patchAgent(agentId, (m) => ({ ...m, status: "Reading your document (quarantined)…" }));
        const form = new FormData();
        form.set("file", attachment);
        const res = await fetch("/api/ingest/upload", { method: "POST", body: form, headers: apiHeaders() });
        const body = (await res.json()) as { documentId?: string; error?: string };
        if (!res.ok || !body.documentId) throw new Error(`Upload failed: ${body.error ?? res.status}`);
        documentIds = [body.documentId];
      }

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: apiHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ message, documentIds }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) apply(agentId, JSON.parse(line) as ChatStreamEvent);
        }
      }
    } catch (e) {
      patchAgent(agentId, (m) => ({ ...m, error: `The agent is unavailable (${(e as Error).message}). No money was moved.`, done: true }));
    } finally {
      setRunning(false);
    }
  }

  function apply(id: string, ev: ChatStreamEvent) {
    switch (ev.type) {
      case "token":
        return patchAgent(id, (m) => ({ ...m, text: m.text + ev.text }));
      case "status":
        return patchAgent(id, (m) => ({ ...m, status: statusLabel(ev.node) }));
      case "feed":
        return patchAgent(id, (m) => ({ ...m, feed: [...m.feed, ev.text] }));
      case "approval_required":
        return patchAgent(id, (m) => ({ ...m, approvalId: ev.approvalId }));
      case "done":
        return patchAgent(id, (m) => ({ ...m, status: undefined, done: true }));
      case "error":
        return patchAgent(id, (m) => ({ ...m, error: `${ev.message} No money was moved.`, done: true }));
    }
  }

  return (
    <div className="flex h-[calc(100dvh-8rem)] flex-col md:h-[calc(100dvh-4rem)]">
      <header className="mb-3">
        <h1 className="text-2xl font-semibold tracking-tight">Chat</h1>
        <p className="text-sm text-grey-500">Ask anything. Reins proposes; your mandate decides.</p>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto rounded-2xl bg-surface p-4 ring-1 ring-grey-100">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-grey-500">Try one of these:</p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="min-h-11 rounded-full bg-grey-50 px-4 text-sm ring-1 ring-grey-100 hover:bg-lime">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => (m.role === "user" ? <UserBubble key={m.id} m={m} /> : <AgentBubble key={m.id} m={m} />))
        )}
        <div ref={endRef} />
      </div>

      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <label className="grid min-h-11 cursor-pointer place-items-center rounded-xl bg-surface px-3 text-sm ring-1 ring-grey-300 hover:bg-grey-50" title="Attach a bill PDF">
          <span aria-hidden>📎</span>
          <span className="sr-only">Attach a bill PDF</span>
          <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <div className="flex-1">
          {file ? (
            <div className="mb-1 text-xs text-grey-500">
              Attached: {file.name} <Badge tone="lavender">untrusted document</Badge>
            </div>
          ) : null}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={file ? "What should Reins do with this bill?" : "Message Reins…"}
            className="min-h-11 w-full rounded-xl bg-surface px-4 text-sm ring-1 ring-grey-300 outline-none focus:ring-2 focus:ring-ink"
            disabled={running}
          />
        </div>
        <Button type="submit" disabled={running || !input.trim()}>
          {running ? "…" : "Send"}
        </Button>
      </form>
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  load_context: "Loading your mandate…",
  reader: "Reading the document in quarantine…",
  signal_reader: "Checking merchant signals…",
  planner: "Planning…",
  persist_plan: "Recording the plan…",
  gate_preview: "Checking your mandate…",
  create_approval: "Preparing an approval…",
  await_approval: "Waiting for your approval",
  execute: "Executing under your mandate…",
  explain: "Writing it up…",
};
const statusLabel = (node: string) => STATUS_LABELS[node] ?? `${node.replaceAll("_", " ")}…`;

function UserBubble({ m }: { m: Extract<Msg, { role: "user" }> }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-sm text-white">
        {m.text}
        {m.attachment ? <div className="mt-1 text-xs text-grey-300">📎 {m.attachment}</div> : null}
      </div>
    </div>
  );
}

function AgentBubble({ m }: { m: Extract<Msg, { role: "agent" }> }) {
  return (
    <div className="flex flex-col items-start gap-2">
      {m.text || m.status || m.error ? (
        <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-grey-50 px-4 py-2.5 text-sm leading-relaxed ring-1 ring-grey-100">
          {m.text ? <p className="whitespace-pre-wrap">{m.text}</p> : null}
          {m.status ? <p className="animate-pulse text-xs text-grey-500">{m.status}</p> : null}
          {m.error ? <p className="text-danger">{m.error}</p> : null}
        </div>
      ) : null}
      {m.feed.map((f, i) => (
        <div key={i} className="max-w-[85%] rounded-xl bg-lime/40 px-3 py-2 text-sm">
          {f}
        </div>
      ))}
      {m.approvalId ? <InlineApproval approvalId={m.approvalId} /> : null}
    </div>
  );
}

/** Loads the card by id from /api/approvals, the only source of approval cards. */
function InlineApproval({ approvalId }: { approvalId: string }) {
  const [state, setState] = useState<{ card?: ApprovalsResponse["items"][number]; result?: DecisionResponse; missing?: boolean }>({});

  useEffect(() => {
    let cancelled = false;
    apiFetch<ApprovalsResponse>("/api/approvals?status=pending")
      .then((r) => {
        if (cancelled) return;
        const card = r.items.find((c) => c.id === approvalId);
        setState(card ? { card } : { missing: true });
      })
      .catch(() => !cancelled && setState({ missing: true }));
    return () => {
      cancelled = true;
    };
  }, [approvalId]);

  if (state.result) {
    const lines = state.result.resume?.feed.length ? state.result.resume.feed : [state.result.status === "approved" ? "Approved." : "Rejected. Nothing was done."];
    return (
      <div className="max-w-[85%] space-y-1">
        {lines.map((l, i) => (
          <div key={i} className="rounded-xl bg-ok-soft px-3 py-2 text-sm text-ok">
            {l}
          </div>
        ))}
      </div>
    );
  }
  if (state.missing) return <p className="text-xs text-grey-500">This approval is no longer pending. See the Approvals tab.</p>;
  if (!state.card) return null;
  return (
    <div className="w-full max-w-md">
      <ApprovalCardView card={state.card} onDecided={(result) => setState((s) => ({ ...s, result }))} />
    </div>
  );
}
