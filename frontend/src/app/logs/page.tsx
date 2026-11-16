"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useApi } from "@/hooks/useApi";
import { useLogStream } from "@/hooks/useLogStream";
import { getJobs, type JobsResponse, type ActivityLog } from "@/lib/api";
import { Activity, Search, RotateCcw, Trash2, ChevronDown } from "lucide-react";

const EV_COLOR: Record<string, string> = {
  job_completed: "#10b981", job_failed: "#f43f5e", job_started: "#3b82f6",
  record_saved: "#6ee7b7", email_found: "#34d399", listings_loaded: "#22d3ee",
  job_cancelled: "#6b7280", job_paused: "#f59e0b", quota_exhausted: "#f43f5e",
};

function LiveLogsPageInner() {
  const sp = useSearchParams();
  const [jobId, setJobId] = useState(sp.get("job_id") || "");
  const [input, setInput] = useState(sp.get("job_id") || "");
  const [autoscroll, setAutoscroll] = useState(true);
  const [levelFilter, setLevelFilter] = useState("All Levels");
  const [compFilter, setCompFilter] = useState("All Components");
  const bottomRef = useRef<HTMLDivElement>(null);
  const contRef = useRef<HTMLDivElement>(null);
  const { data: jobs } = useApi<JobsResponse>(() => getJobs(1), [], { poll: 10000 });
  const { logs, state, err, clear } = useLogStream(jobId || null);

  useEffect(() => { if (autoscroll && bottomRef.current) bottomRef.current.scrollIntoView({ behavior: "smooth" }); }, [logs, autoscroll]);
  function onScroll() { const el = contRef.current; if (!el) return; setAutoscroll(el.scrollTop + el.clientHeight >= el.scrollHeight - 40); }
  function load(id: string) { const t = id.trim(); if (!t) return; setJobId(t); setInput(t); setAutoscroll(true); }

  const dotColor = state === "streaming" ? "#10b981" : state === "connecting" ? "#f59e0b" : state === "error" ? "#f43f5e" : "#475569";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#070d1a" }}>
      {/* Top bar */}
      <div style={{ background: "#0d1524", borderBottom: "1px solid #1e2d42", padding: "10px 16px", display: "flex", alignItems: "center", gap: 10, flexShrink: 0, flexWrap: "wrap" }}>
        <Activity size={15} color="#10b981" />
        <span style={{ fontSize: 13, fontWeight: 700, color: "#e8edf5", marginRight: 4 }}>Activity Logs</span>
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "#4a6070" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: dotColor, boxShadow: state === "streaming" ? `0 0 6px ${dotColor}` : undefined }} />
          {state === "streaming" ? "Live" : state === "connecting" ? "Connecting…" : state === "done" ? "Finished" : state === "error" ? "Error" : "Not connected"}
        </span>

        {/* Filters */}
        <select value={levelFilter} onChange={e => setLevelFilter(e.target.value)} style={{ marginLeft: 8, height: 26, padding: "0 8px", borderRadius: 5, fontSize: 10, background: "#111d2e", border: "1px solid #1e2d42", color: "#c8d5e8" }}>
          {["All Levels", "INFO", "WARN", "ERROR"].map(o => <option key={o}>{o}</option>)}
        </select>
        <select value={compFilter} onChange={e => setCompFilter(e.target.value)} style={{ height: 26, padding: "0 8px", borderRadius: 5, fontSize: 10, background: "#111d2e", border: "1px solid #1e2d42", color: "#c8d5e8" }}>
          {["All Components", "scraper", "dedup", "quota", "email"].map(o => <option key={o}>{o}</option>)}
        </select>

        {/* Job picker */}
        <select value={jobId} onChange={e => load(e.target.value)} style={{ height: 26, padding: "0 8px", borderRadius: 5, fontSize: 10, background: "#111d2e", border: "1px solid #1e2d42", color: "#c8d5e8", maxWidth: 220 }}>
          <option value="">— Select job —</option>
          {(jobs?.items ?? []).map(j => <option key={j.id} value={j.id}>[{j.status}] {j.search_query || j.category || "Untitled"}</option>)}
        </select>
        <div style={{ display: "flex", gap: 4 }}>
          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && load(input)} placeholder="paste Job ID…" style={{ height: 26, padding: "0 8px", borderRadius: 5, fontSize: 10, background: "#111d2e", border: "1px solid #1e2d42", color: "#c8d5e8", width: 200 }} />
          <button onClick={() => load(input)} disabled={!input.trim()} style={{ height: 26, width: 26, borderRadius: 5, background: "#2563eb", border: "none", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Search size={11} /></button>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          {logs.length > 0 && <span style={{ fontSize: 10, color: "#3d5068" }}>{logs.length} events</span>}
          <button onClick={() => setAutoscroll(v => !v)} style={{ height: 26, width: 26, borderRadius: 5, border: "1px solid #1e2d42", background: autoscroll ? "#2563eb" : "#111d2e", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }} title={autoscroll ? "Pause scroll" : "Resume scroll"}><ChevronDown size={12} /></button>
          {jobId && <button onClick={() => { clear(); setJobId(""); setInput(""); }} style={{ height: 26, width: 26, borderRadius: 5, border: "1px solid #1e2d42", background: "#111d2e", color: "#4a6070", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><RotateCcw size={11} /></button>}
          {logs.length > 0 && <button onClick={clear} style={{ height: 26, width: 26, borderRadius: 5, border: "1px solid #1e2d42", background: "#111d2e", color: "#4a6070", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Trash2 size={11} /></button>}
        </div>
      </div>

      {/* Header row */}
      <div style={{ background: "#0d1524", borderBottom: "1px solid #1e2d42", display: "grid", gridTemplateColumns: "80px 24px 160px 1fr", gap: 0, padding: "5px 14px", flexShrink: 0 }}>
        {["Time", "", "Event", "Message"].map(h => <span key={h} style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "#3d5068" }}>{h}</span>)}
      </div>

      {/* Log body */}
      <div ref={contRef} onScroll={onScroll} style={{ flex: 1, overflowY: "auto", fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>
        {!jobId && <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "50%", color: "#3d5068", gap: 10 }}>
          <Activity size={32} style={{ opacity: .3 }} />
          <p style={{ margin: 0 }}>Select or paste a Job ID to start streaming</p>
        </div>}
        {jobId && state === "connecting" && !logs.length && <div style={{ padding: "20px 14px", color: "#4a6070", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 12, height: 12, border: "1.5px solid #3b82f6", borderTopColor: "transparent", borderRadius: "50%", animation: "spin .7s linear infinite" }} />Connecting to stream…
        </div>}
        {err && <div style={{ padding: "8px 14px", color: "#f43f5e", fontSize: 10 }}>⚠ {err}</div>}
        {logs.map((ev, i) => {
          const ts = ev.timestamp || ev.ts || "";
          const color = EV_COLOR[ev.event_type] || "#60a5fa";
          return (
            <div key={ev.id || i} style={{ display: "grid", gridTemplateColumns: "80px 24px 160px 1fr", padding: "4px 14px", borderBottom: "1px solid rgba(30,45,66,.4)" }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(59,130,246,.04)"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}>
              <span style={{ color: "#3d5068", fontVariantNumeric: "tabular-nums" }}>{ts ? new Date(ts).toLocaleTimeString("en-US", { hour12: false }) : "—"}</span>
              <span>{i % 2 === 0 ? "" : "⋅"}</span>
              <span style={{ color, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.event_type}</span>
              <span style={{ color: "#8ba0b4" }}>{ev.message}</span>
            </div>
          );
        })}
        {state === "done" && logs.length > 0 && <div style={{ padding: "8px 14px", color: "#3d5068", borderTop: "1px solid #1e2d42", marginTop: 4, fontSize: 10 }}>── stream ended · {logs.length} total events ──</div>}
        <div ref={bottomRef} />
      </div>

      {/* Status bar */}
      {jobId && <div style={{ background: "#0d1524", borderTop: "1px solid #1e2d42", padding: "5px 14px", display: "flex", alignItems: "center", gap: 12, fontSize: 10, color: "#3d5068", fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>
        <span>job: <span style={{ color: "#4a6070" }}>{jobId.slice(0, 20)}…</span></span>
        {!autoscroll && <button onClick={() => { setAutoscroll(true); bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }} style={{ color: "#3b82f6", background: "none", border: "none", cursor: "pointer", fontSize: 10, padding: 0 }}>↓ scroll to bottom</button>}
        <span style={{ marginLeft: "auto" }}>{new Date().toLocaleTimeString()}</span>
      </div>}
    </div>
  );
}

export default function LiveLogsPage() {
  return (
    <Suspense fallback={<div style={{ padding: 32, color: "var(--text-3)" }}>Loading…</div>}>
      <LiveLogsPageInner />
    </Suspense>
  );
}
