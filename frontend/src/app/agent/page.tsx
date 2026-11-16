"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Bot, Send, Plus, Trash2, Loader2, ChevronDown, ChevronRight,
  Zap, Database, Download, Activity, Settings2, CheckCircle2,
  AlertCircle, Clock, MessageSquare, Wrench, ShieldAlert,
  RefreshCw, ExternalLink, Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Provider {
  name: string;
  configured: boolean;
  env_var: string | null;
  models: string[];
}

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
  blocked_reason?: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  tool_calls?: ToolCall[];
  loop_detected?: boolean;
  ts?: number;
}

interface Session {
  id: string;
  title: string;
  provider: string;
  model: string;
  created_at: number;
  updated_at: number;
  message_count: number;
  job_ids: string[];
  messages?: Message[];
}

// ─────────────────────────────────────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────────────────────────────────────

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5000";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error((b as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool helpers
// ─────────────────────────────────────────────────────────────────────────────

function ToolIcon({ name }: { name: string }) {
  if (name.includes("job")) return <Zap className="w-3 h-3" />;
  if (name.includes("export")) return <Download className="w-3 h-3" />;
  if (name.includes("business")) return <Database className="w-3 h-3" />;
  if (name.includes("health")) return <Activity className="w-3 h-3" />;
  if (name.includes("dashboard")) return <Settings2 className="w-3 h-3" />;
  return <Wrench className="w-3 h-3" />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool call card — handles normal, blocked, and export-result states
// ─────────────────────────────────────────────────────────────────────────────

function ToolCallCard({ tc }: { tc: ToolCall }) {
  const [open, setOpen] = useState(false);

  const isBlocked = !!tc.blocked_reason;
  const hasError = !isBlocked && "error" in tc.result;
  const isExport = tc.name === "export_data" && !isBlocked && !hasError;
  const downloadUrl = isExport ? (tc.result.full_url as string | undefined) : undefined;

  const statusIcon = isBlocked
    ? <Lock className="w-3 h-3 text-amber-400 shrink-0" />
    : hasError
      ? <AlertCircle className="w-3 h-3 text-red-400 shrink-0" />
      : <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />;

  const bgColor = isBlocked
    ? "bg-amber-500/15 text-amber-300"
    : hasError
      ? "bg-red-500/15 text-red-400"
      : "bg-blue-500/15 text-blue-400";

  return (
    <div
      className={cn("rounded-lg border text-xs overflow-hidden",
        isBlocked && "opacity-70")}
      style={{
        borderColor: isBlocked ? "rgba(245,158,11,0.3)" : "var(--border)",
        background: "var(--surface-2)"
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:opacity-80 transition-opacity"
      >
        <span className={cn("flex items-center justify-center w-5 h-5 rounded-md shrink-0", bgColor)}>
          <ToolIcon name={tc.name} />
        </span>
        <span className="font-mono font-semibold flex-1 text-left truncate" style={{ color: "var(--fg)" }}>
          {tc.name}
        </span>
        {isBlocked && (
          <span className="text-[10px] font-medium text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded shrink-0">
            awaiting approval
          </span>
        )}
        {statusIcon}
        {open
          ? <ChevronDown className="w-3 h-3 shrink-0" style={{ color: "var(--fg-muted)" }} />
          : <ChevronRight className="w-3 h-3 shrink-0" style={{ color: "var(--fg-muted)" }} />}
      </button>

      {open && (
        <div className="border-t px-3 py-2 space-y-2" style={{ borderColor: "var(--border)" }}>
          {/* Blocked reason banner */}
          {isBlocked && (
            <div className="flex items-center gap-2 text-[11px] text-amber-300 bg-amber-500/10 rounded px-2 py-1.5">
              <Lock className="w-3 h-3 shrink-0" />
              Blocked — waiting for your confirmation before executing.
            </div>
          )}

          {/* Arguments */}
          {Object.keys(tc.args).length > 0 && (
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color: "var(--fg-muted)" }}>
                Arguments
              </p>
              <pre className="text-[11px] rounded p-2 overflow-x-auto"
                style={{ background: "var(--surface-3)", color: "var(--fg-muted)" }}>
                {JSON.stringify(tc.args, null, 2)}
              </pre>
            </div>
          )}

          {/* Result (only for executed tools) */}
          {!isBlocked && (
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color: "var(--fg-muted)" }}>
                Result
              </p>
              {/* Export download button */}
              {downloadUrl && (
                <a
                  href={downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-400 hover:text-emerald-300 mb-2 transition-colors"
                >
                  <Download className="w-3 h-3" />
                  Download {(tc.args.format as string ?? "file").toUpperCase()}
                  <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                </a>
              )}
              <pre
                className="text-[11px] rounded p-2 overflow-x-auto"
                style={{
                  background: "var(--surface-3)",
                  color: hasError ? "#f87171" : "var(--fg-muted)",
                }}
              >
                {JSON.stringify(tc.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Markdown-ish formatter — handles bold, inline code, tables, line breaks
// ─────────────────────────────────────────────────────────────────────────────

function FormattedMessage({ content }: { content: string }) {
  const lines = content.split("\n");

  // Detect markdown table block
  const tableStart = lines.findIndex((l) => l.trim().startsWith("|"));

  if (tableStart !== -1) {
    // Split into before-table, table rows, after-table
    const before: string[] = [];
    const tableRows: string[] = [];
    const after: string[] = [];
    let inTable = false;

    for (const line of lines) {
      const isTableRow = line.trim().startsWith("|");
      const isSeparator = /^\|[\s\-|]+\|$/.test(line.trim());
      if (isTableRow) {
        inTable = true;
        if (!isSeparator) tableRows.push(line);
      } else {
        if (inTable) {
          inTable = false;
          after.push(line);
        } else {
          before.push(line);
        }
      }
    }

    const headers = tableRows[0]?.split("|").filter((c) => c.trim()).map((c) => c.trim()) ?? [];
    const rows = tableRows.slice(1).map((r) =>
      r.split("|").filter((c) => c.trim()).map((c) => c.trim())
    );

    return (
      <div className="space-y-2">
        {before.length > 0 && (
          <div className="space-y-1">
            {before.map((l, i) => <InlineLine key={i} text={l} />)}
          </div>
        )}
        {headers.length > 0 && rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: "var(--surface-3)" }}>
                  {headers.map((h, i) => (
                    <th key={i} className="px-3 py-2 text-left font-semibold"
                      style={{ color: "var(--fg)", borderBottom: "1px solid var(--border)" }}>
                      <InlineLine text={h} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri} style={{ borderBottom: "1px solid var(--border)" }}
                    className="transition-colors hover:bg-white/5">
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-3 py-2" style={{ color: "var(--fg-muted)" }}>
                        <InlineLine text={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {after.length > 0 && (
          <div className="space-y-1">
            {after.map((l, i) => <InlineLine key={i} text={l} />)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {lines.map((l, i) => !l.trim() ? <br key={i} /> : <InlineLine key={i} text={l} />)}
    </div>
  );
}

function InlineLine({ text }: { text: string }) {
  if (!text.trim()) return null;
  // Split on **bold** and `code`
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <p className="leading-relaxed">
      {parts.map((p, i) => {
        if (p.startsWith("**") && p.endsWith("**"))
          return <strong key={i} style={{ color: "var(--fg)" }}>{p.slice(2, -2)}</strong>;
        if (p.startsWith("`") && p.endsWith("`"))
          return (
            <code key={i} className="px-1 py-0.5 rounded text-xs font-mono"
              style={{ background: "var(--surface-3)", color: "var(--accent, #60a5fa)" }}>
              {p.slice(1, -1)}
            </code>
          );
        return p;
      })}
    </p>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Message bubble
// ─────────────────────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: Message }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm text-white"
          style={{ background: "linear-gradient(135deg,#2563eb,#7c3aed)" }}>
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
        style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
        <Bot className="w-4 h-4 text-blue-400" />
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        {/* Loop detected warning */}
        {msg.loop_detected && (
          <div className="flex items-center gap-2 text-xs text-amber-300 px-3 py-2 rounded-lg"
            style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)" }}>
            <RefreshCw className="w-3.5 h-3.5 shrink-0" />
            Loop detected — identical repeated tool call stopped automatically.
          </div>
        )}

        {/* Tool calls */}
        {msg.tool_calls && msg.tool_calls.length > 0 && (
          <div className="space-y-1">
            {msg.tool_calls.map((tc, i) => <ToolCallCard key={i} tc={tc} />)}
          </div>
        )}

        {/* Text reply */}
        {msg.content && (
          <div className="rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm"
            style={{ background: "var(--surface-2)", color: "var(--fg)" }}>
            <FormattedMessage content={msg.content} />
          </div>
        )}

        {!msg.content && (!msg.tool_calls?.length) && (
          <div className="rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm"
            style={{ background: "var(--surface-2)", color: "var(--fg-muted)" }}>…</div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Typing indicator
// ─────────────────────────────────────────────────────────────────────────────

function TypingIndicator({ step }: { step: string }) {
  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
        style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
        <Bot className="w-4 h-4 text-blue-400" />
      </div>
      <div className="rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm flex items-center gap-2"
        style={{ background: "var(--surface-2)", color: "var(--fg-muted)" }}>
        <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
        <span>{step || "Thinking…"}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider badge
// ─────────────────────────────────────────────────────────────────────────────

const PROVIDER_COLORS: Record<string, string> = {
  groq: "bg-orange-500/20 text-orange-300",
  openai: "bg-emerald-500/20 text-emerald-300",
  anthropic: "bg-purple-500/20 text-purple-300",
  local: "bg-cyan-500/20 text-cyan-300",
  mock: "bg-slate-500/20 text-slate-300",
};

function ProviderBadge({ name }: { name: string }) {
  return (
    <span className={cn(
      "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
      PROVIDER_COLORS[name] ?? "bg-slate-500/20 text-slate-300"
    )}>
      {name}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Suggested prompts
// ─────────────────────────────────────────────────────────────────────────────

const SUGGESTIONS = [
  "Show me the dashboard summary",
  "Find 5 restaurants in New York, ZIP 10001",
  "List all running jobs",
  "Scrape 50 dentists in London, UK",
  "Export all data as Excel",
  "Check system health",
];

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function AgentPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState("mock");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const evtSourceRef = useRef<EventSource | null>(null);

  // Load providers + sessions on mount
  useEffect(() => {
    apiFetch<{ providers: Provider[] }>("/agent/providers")
      .then((d) => {
        setProviders(d.providers);
        const configured = d.providers.find((p) => p.configured);
        if (configured) setSelectedProvider(configured.name);
      })
      .catch(() => { });
    loadSessions();
  }, []);

  // Cleanup SSE on unmount
  useEffect(() => () => { evtSourceRef.current?.close(); }, []);

  // Scroll to bottom
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [input]);

  const loadSessions = async () => {
    try {
      const d = await apiFetch<{ sessions: Session[] }>("/agent/sessions");
      setSessions(d.sessions);
    } catch { }
  };

  const createSession = async (): Promise<Session | null> => {
    try {
      const s = await apiFetch<Session>("/agent/sessions", {
        method: "POST",
        body: JSON.stringify({ provider: selectedProvider }),
      });
      setSessions((prev) => [s, ...prev]);
      setCurrentSession(s);
      setMessages([]);
      setError(null);
      return s;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  const loadSession = async (s: Session) => {
    try {
      const full = await apiFetch<Session>(`/agent/sessions/${s.id}`);
      setCurrentSession(full);
      // Reconstruct messages — fold tool_calls back into assistant messages
      const msgs = (full.messages ?? []).filter(
        (m) => m.role === "user" || m.role === "assistant"
      );
      setMessages(msgs);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const deleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await apiFetch(`/agent/sessions/${id}`, { method: "DELETE" });
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (currentSession?.id === id) { setCurrentSession(null); setMessages([]); }
    } catch { }
  };

  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;

    // Auto-create session if needed
    let session = currentSession;
    if (!session) {
      session = await createSession();
      if (!session) return;
    }

    setInput("");
    setError(null);
    const userMsg: Message = { role: "user", content: text, ts: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);
    setLoadingStep("Thinking…");

    // Close any existing SSE connection
    evtSourceRef.current?.close();

    const url = `${BASE}/api/agent/sessions/${session.id}/chat/stream?${new URLSearchParams({
      message: text,
      provider: selectedProvider,
    })}`;

    const es = new EventSource(url);
    evtSourceRef.current = es;

    // Per-turn accumulators
    let replyChunks: string[] = [];
    let toolCalls: ToolCall[] = [];
    let loopDetected = false;
    let currentToolName = "";
    let currentToolArgs: Record<string, unknown> = {};

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as Record<string, unknown>;

        switch (data.type) {

          case "tool_call":
            setLoadingStep(`Calling ${data.tool}…`);
            currentToolName = data.tool as string;
            currentToolArgs = (data.args ?? {}) as Record<string, unknown>;
            break;

          case "tool_result":
            toolCalls.push({
              name: currentToolName,
              args: currentToolArgs,
              result: (data.result ?? {}) as Record<string, unknown>,
            });
            setLoadingStep(`Got result from ${currentToolName}…`);
            break;

          case "tool_blocked":
            // State-changing tool blocked by approval gate
            toolCalls.push({
              name: data.tool as string,
              args: currentToolArgs,
              result: {},
              blocked_reason: (data.reason as string) ?? "awaiting_approval",
            });
            setLoadingStep("Waiting for your confirmation…");
            break;

          case "loop_detected":
            loopDetected = true;
            setLoadingStep("Loop detected — stopping…");
            break;

          case "reply_start":
            setLoadingStep("Writing reply…");
            break;

          case "reply_chunk": {
            replyChunks.push((data.chunk as string) ?? "");
            const partial = replyChunks.join("");
            setMessages((prev) => {
              const copy = [...prev];
              const last = copy[copy.length - 1];
              if (last?.role === "assistant" && last.ts === -1) {
                copy[copy.length - 1] = { ...last, content: partial };
              } else {
                copy.push({
                  role: "assistant", content: partial,
                  tool_calls: toolCalls, loop_detected: loopDetected, ts: -1,
                });
              }
              return copy;
            });
            break;
          }

          case "reply_end": {
            const finalReply = replyChunks.join("");
            const loopFlag = (data.loop_detected as boolean) || loopDetected;
            setMessages((prev) => [
              ...prev.filter((m) => !(m.role === "assistant" && m.ts === -1)),
              {
                role: "assistant",
                content: finalReply,
                tool_calls: toolCalls,
                loop_detected: loopFlag,
                ts: Date.now(),
              },
            ]);
            es.close();
            evtSourceRef.current = null;
            setLoading(false);
            setLoadingStep("");
            loadSessions();
            break;
          }

          case "error":
            setError(data.message as string);
            es.close();
            evtSourceRef.current = null;
            setLoading(false);
            setLoadingStep("");
            break;
        }
      } catch { }
    };

    es.onerror = () => {
      es.close();
      evtSourceRef.current = null;
      // Fallback to non-streaming POST
      apiFetch<{ reply: string; tool_calls: ToolCall[]; loop_detected?: boolean }>(
        `/agent/sessions/${session!.id}/chat`,
        {
          method: "POST",
          body: JSON.stringify({ message: text, provider: selectedProvider }),
        }
      )
        .then((d) => {
          setMessages((prev) => [
            ...prev.filter((m) => !(m.role === "assistant" && m.ts === -1)),
            {
              role: "assistant",
              content: d.reply,
              tool_calls: d.tool_calls ?? [],
              loop_detected: d.loop_detected,
              ts: Date.now(),
            },
          ]);
          loadSessions();
        })
        .catch((err: Error) => setError(err.message))
        .finally(() => { setLoading(false); setLoadingStep(""); });
    };
  }, [input, loading, currentSession, selectedProvider]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full" style={{ background: "var(--page-bg)" }}>

      {/* ── Sessions sidebar ───────────────────────────────────────────── */}
      <div
        className={cn(
          "shrink-0 flex flex-col border-r transition-[width] duration-200 overflow-hidden",
          sidebarOpen ? "w-[220px]" : "w-0"
        )}
        style={{ borderColor: "var(--border)", background: "var(--surface-1)" }}
      >
        <div className="flex items-center justify-between px-3 py-3 border-b shrink-0"
          style={{ borderColor: "var(--border)" }}>
          <span className="text-xs font-bold uppercase tracking-widest"
            style={{ color: "var(--fg-muted)" }}>Sessions</span>
          <button
            onClick={() => createSession()}
            className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-blue-500/20 transition-colors text-blue-400"
            title="New Session"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {sessions.length === 0 && (
            <p className="text-xs text-center mt-6 px-3" style={{ color: "var(--fg-muted)" }}>
              No sessions yet. Click + to start.
            </p>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              role="button"
              tabIndex={0}
              onClick={() => loadSession(s)}
              onKeyDown={(e) => e.key === "Enter" && loadSession(s)}
              className={cn(
                "w-full text-left px-3 py-2.5 group flex items-start gap-2",
                "hover:opacity-80 transition-opacity border-b cursor-pointer",
                currentSession?.id === s.id && "bg-blue-500/10"
              )}
              style={{ borderColor: "var(--border)" }}
            >
              <MessageSquare className="w-3 h-3 mt-0.5 shrink-0"
                style={{ color: "var(--fg-muted)" }} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate" style={{ color: "var(--fg)" }}>
                  {s.title}
                </p>
                <p className="text-[10px] flex items-center gap-1 mt-0.5"
                  style={{ color: "var(--fg-muted)" }}>
                  <Clock className="w-2.5 h-2.5" />
                  {s.message_count} msgs
                  {s.job_ids.length > 0 && (
                    <span className="ml-1 text-blue-400">· {s.job_ids.length} jobs</span>
                  )}
                </p>
              </div>
              <button
                onClick={(e) => deleteSession(s.id, e)}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:text-red-400"
                style={{ color: "var(--fg-muted)" }}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Main chat area ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0"
          style={{ borderColor: "var(--border)", background: "var(--surface-1)" }}>
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
            style={{ color: "var(--fg-muted)" }}
          >
            <Bot className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-bold" style={{ color: "var(--fg)" }}>
              {currentSession ? currentSession.title : "AI Agent"}
            </h1>
            <p className="text-[10px]" style={{ color: "var(--fg-muted)" }}>
              {currentSession
                ? `Session · ${currentSession.id.slice(0, 8)}…`
                : "Create a session to start chatting"}
            </p>
          </div>

          {/* Provider selector */}
          <div className="flex items-center gap-2">
            <ProviderBadge name={selectedProvider} />
            <select
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value)}
              className="text-xs rounded-lg px-2 py-1 border outline-none"
              style={{
                background: "var(--surface-2)",
                borderColor: "var(--border)",
                color: "var(--fg)",
              }}
            >
              {providers.map((p) => (
                <option key={p.name} value={p.name} disabled={!p.configured}>
                  {p.name}{!p.configured ? " (not configured)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

          {/* Empty state — no session */}
          {!currentSession && (
            <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg,#2563eb22,#7c3aed22)",
                  border: "1px solid var(--border)"
                }}>
                <Bot className="w-8 h-8 text-blue-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold mb-1" style={{ color: "var(--fg)" }}>
                  AI Scraping Agent
                </h2>
                <p className="text-sm max-w-md" style={{ color: "var(--fg-muted)" }}>
                  Chat with your scraper. Search data, start jobs, monitor progress,
                  and export results — all in natural language.
                </p>
              </div>
              <button
                onClick={() => createSession()}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: "linear-gradient(135deg,#2563eb,#7c3aed)" }}
              >
                <Plus className="w-4 h-4" />
                New Session
              </button>
              <div className="grid grid-cols-2 gap-2 max-w-lg w-full">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={async () => {
                      const sess = await createSession();
                      if (sess) sendMessage(s);
                    }}
                    className="text-left text-xs px-3 py-2.5 rounded-xl border transition-colors hover:border-blue-500/50"
                    style={{
                      background: "var(--surface-2)", borderColor: "var(--border)",
                      color: "var(--fg-muted)"
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Session exists but empty */}
          {currentSession && messages.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
              <Bot className="w-10 h-10 text-blue-400 opacity-40" />
              <p className="text-sm" style={{ color: "var(--fg-muted)" }}>
                Start the conversation below, or pick a suggestion:
              </p>
              <div className="grid grid-cols-2 gap-2 max-w-lg w-full">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => sendMessage(s)}
                    className="text-left text-xs px-3 py-2.5 rounded-xl border transition-colors hover:border-blue-500/50"
                    style={{
                      background: "var(--surface-2)", borderColor: "var(--border)",
                      color: "var(--fg-muted)"
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Message list */}
          {messages.map((msg, i) => <MessageBubble key={i} msg={msg} />)}

          {/* Loading indicator */}
          {loading && <TypingIndicator step={loadingStep} />}

          {/* Error banner */}
          {error && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm text-red-400"
              style={{
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.2)"
              }}>
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          {/* Loop warning (shown above input area) */}
          {!loading && messages.some((m) => m.loop_detected) && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm text-amber-300"
              style={{
                background: "rgba(245,158,11,0.1)",
                border: "1px solid rgba(245,158,11,0.2)"
              }}>
              <ShieldAlert className="w-4 h-4 shrink-0" />
              A loop was detected and stopped. Try rephrasing or breaking the request into smaller steps.
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        {(currentSession || true) && (
          <div className="shrink-0 border-t px-4 py-3"
            style={{ borderColor: "var(--border)", background: "var(--surface-1)" }}>
            <div className="flex items-end gap-2 rounded-2xl border px-3 py-2 transition-colors"
              style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  currentSession
                    ? "Message the agent… (Enter to send, Shift+Enter for newline)"
                    : "Type to start a new session automatically…"
                }
                disabled={loading}
                className="flex-1 resize-none bg-transparent text-sm outline-none py-1 min-h-[32px] max-h-[160px]"
                style={{ color: "var(--fg)" }}
              />
              <button
                onClick={() => sendMessage()}
                disabled={loading || !input.trim()}
                className={cn(
                  "flex items-center justify-center w-8 h-8 rounded-xl shrink-0 transition-all",
                  input.trim() && !loading
                    ? "text-white hover:opacity-90"
                    : "opacity-30 cursor-not-allowed"
                )}
                style={
                  input.trim() && !loading
                    ? { background: "linear-gradient(135deg,#2563eb,#7c3aed)" }
                    : { background: "var(--surface-3)" }
                }
              >
                {loading
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Send className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[10px] mt-1.5 text-center" style={{ color: "var(--fg-muted)" }}>
              State-changing actions (create job, export, pause) require your explicit confirmation.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
