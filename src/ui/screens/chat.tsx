"use client";

// Chat (docs/ui-direction.md §7): a bar on Home that opens full screen. Streams POST /api/chat
// (newline-delimited ChatStreamEvent). The agent's text is shown as the agent's words; anything
// that needs an OK is a link to the approval card, which is built by the server, never from
// streamed text.

import { ArrowLeft, ArrowUp, HandPalm, Paperclip, X } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ChatStreamEvent } from "@/src/server/api-types";

type Msg =
  | { role: "user"; text: string }
  | { role: "agent"; text: string; status: string | null; approval: boolean; error: string | null; done: boolean };

const STARTERS = ["What do I need to pay this week?", "Why was a payment blocked?", "Which subscriptions should I cancel?"];

// Graph node names (src/agent/graph.ts) -> plain progress words.
const NODE_TEXT: Record<string, string> = {
  load_context: "Looking at your accounts",
  reader: "Reading the document",
  signal_reader: "Checking news about the business",
  planner: "Working out what to do",
  read_tools: "Looking up your data",
  persist_plan: "Writing down the plan",
  gate_preview: "Checking your rules",
  create_approval: "Preparing a request for your OK",
  await_approval: "Waiting for your OK",
  execute: "Checking your rules again and doing it",
  record_deny: "Recording why it was blocked",
  explain: "Writing a short explanation",
};

type Attachment = { documentId: string; name: string };

export function ChatScreen() {
  const params = useSearchParams();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState(() => params.get("ask") ?? "");
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function attachFile(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await fetch("/api/ingest/upload", { method: "POST", body: form });
      const body = (await r.json().catch(() => null)) as { documentId?: string; error?: string } | null;
      if (!r.ok || !body?.documentId) throw new Error(body?.error ?? String(r.status));
      setAttachments((a) => [...a, { documentId: body.documentId!, name: file.name }]);
    } catch {
      setUploadError("Could not attach that file. PDFs only, up to 10 MB.");
    } finally {
      setUploading(false);
    }
  }

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [msgs]);

  function patchLast(fn: (m: Extract<Msg, { role: "agent" }>) => Extract<Msg, { role: "agent" }>) {
    setMsgs((all) => {
      const last = all[all.length - 1];
      if (!last || last.role !== "agent") return all;
      return [...all.slice(0, -1), fn(last)];
    });
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    const documentIds = attachments.map((a) => a.documentId);
    setInput("");
    setAttachments([]);
    setBusy(true);
    setMsgs((m) => [...m, { role: "user", text: message }, { role: "agent", text: "", status: null, approval: false, error: null, done: false }]);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, ...(documentIds.length ? { documentIds } : {}) }),
      });
      if (!r.ok || !r.body) throw new Error(String(r.status));
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as ChatStreamEvent;
          if (ev.type === "token") patchLast((m) => ({ ...m, text: m.text + ev.text }));
          if (ev.type === "status") patchLast((m) => ({ ...m, status: NODE_TEXT[ev.node] ?? "Working" }));
          if (ev.type === "approval_required") patchLast((m) => ({ ...m, approval: true }));
          if (ev.type === "error") patchLast((m) => ({ ...m, error: "The agent is unavailable. No money was moved." }));
          if (ev.type === "done") patchLast((m) => ({ ...m, done: true, status: null }));
        }
      }
      patchLast((m) => ({ ...m, done: true, status: null }));
    } catch {
      patchLast((m) => ({ ...m, done: true, status: null, error: "The agent is unavailable. No money was moved." }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-9rem)] max-w-2xl flex-col lg:min-h-[calc(100dvh-5rem)]">
      <div className="flex items-center gap-2 pb-4">
        <Link href="/" className="grid size-11 place-items-center rounded-full hover:bg-sunken" aria-label="Back to Home">
          <ArrowLeft size={20} aria-hidden />
        </Link>
        <h1 className="text-[24px] font-semibold tracking-tight lg:text-[28px]">Ask Reins</h1>
      </div>

      <div className="flex-1 space-y-4" aria-live="polite">
        {msgs.length === 0 && (
          <div className="pt-6">
            <p className="text-[15px] text-muted">
              Ask about your bills, subscriptions or packages. Reins can prepare things for you, but it always follows your rules and
              asks before anything that needs your OK.
            </p>
            <ul className="mt-5 flex flex-wrap gap-2">
              {STARTERS.map((s) => (
                <li key={s}>
                  <button onClick={() => send(s)} className="min-h-11 rounded-full border border-line px-4 text-[14px] hover:bg-sunken">
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[85%] rounded-card rounded-br-md bg-ink px-4 py-3 text-[15px] text-page">{m.text}</p>
            </div>
          ) : (
            <div key={i} className="max-w-[85%]">
              <p className="mb-1 text-[12px] font-semibold text-muted">Reins</p>
              {m.text && <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{m.text}</p>}
              {!m.done && !m.error && <p className="text-[14px] text-muted">{m.status ?? "Thinking"}…</p>}
              {m.approval && (
                <Link
                  href="/"
                  className="mt-3 flex min-h-11 items-center gap-2 rounded-card bg-ask-bg px-4 py-3 text-[15px] font-semibold text-ask"
                >
                  <HandPalm size={18} weight="bold" aria-hidden />
                  This needs your OK. Open it on Home.
                </Link>
              )}
              {m.error && (
                <p role="alert" className="mt-2 rounded-field bg-stop-bg px-3 py-2 text-[14px] text-stop">
                  {m.error}
                </p>
              )}
            </div>
          ),
        )}
        <div ref={end} />
      </div>

      <div className="sticky bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+5rem)] mt-6 lg:bottom-6">
        {(attachments.length > 0 || uploading || uploadError) && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((a) => (
              <span key={a.documentId} className="flex items-center gap-1.5 rounded-full border border-line bg-surface py-1.5 pr-1.5 pl-3 text-[13px]">
                {a.name}
                <button
                  type="button"
                  onClick={() => setAttachments((all) => all.filter((x) => x.documentId !== a.documentId))}
                  aria-label={`Remove ${a.name}`}
                  className="grid size-6 place-items-center rounded-full hover:bg-sunken"
                >
                  <X size={14} aria-hidden />
                </button>
              </span>
            ))}
            {uploading && <span className="rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] text-muted">Attaching…</span>}
            {uploadError && <span className="rounded-field bg-stop-bg px-3 py-1.5 text-[13px] text-stop">{uploadError}</span>}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-end gap-2 rounded-card border border-line bg-surface p-2 shadow-pop"
        >
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) attachFile(file);
            }}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={uploading || busy}
            aria-label="Attach a PDF bill"
            className="grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-sunken disabled:opacity-30"
          >
            <Paperclip size={20} aria-hidden />
          </button>
          <label htmlFor="chat-input" className="sr-only">
            Message
          </label>
          <textarea
            id="chat-input"
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Ask about your money"
            className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-[16px] placeholder:text-muted focus:outline-none lg:text-[15px]"
          />
          <button
            type="submit"
            disabled={!input.trim() || busy}
            aria-label="Send"
            className="grid size-11 shrink-0 place-items-center rounded-full bg-ink text-page disabled:opacity-30"
          >
            <ArrowUp size={20} weight="bold" aria-hidden />
          </button>
        </form>
      </div>
    </div>
  );
}
