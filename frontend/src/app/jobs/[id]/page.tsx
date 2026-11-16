"use client";
import { useParams } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { useApi } from "@/hooks/useApi";
import { useSSE } from "@/hooks/useSSE";
import { useLogStream } from "@/hooks/useLogStream";
import { getJob, pauseJob, resumeJob, cancelJob, type Job } from "@/lib/api";
import { fmtDate } from "@/lib/utils";
import { Badge, Btn, Bar, Spin } from "@/components/ui";
import { ArrowLeft, Play, Pause, XCircle, Activity, ExternalLink, FileText, BarChart3, Download } from "lucide-react";

function statusType(s: string): "blue" | "green" | "amber" | "red" | "purple" | "gray" {
  return s === "running" ? "blue" : s === "completed" ? "green" : s === "queued" ? "amber" : s === "failed" ? "red" : s === "paused" ? "purple" : "gray";
}
function statusDotColor(s: string) {
  return s === "running" ? "#6366f1" : s === "completed" ? "#22c55e" : s === "failed" ? "#ef4444" : s === "queued" ? "#f59e0b" : "#52525b";
}

const TABS = ["Overview", "Details", "Logs"];

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState("Overview");
  const [acting, setActing] = useState(false);
  const { data: job, loading, refresh } = useApi<Job>(() => getJob(id), [id], { poll: 5000 });
  const { evt } = useSSE(job && ["running", "queued", "paused", "interrupted"].includes(job.status) ? id : null);
  const { logs, state: logState } = useLogStream(id);

  async function act(fn: () => Promise<Job>) { setActing(true); try { await fn(); refresh(); } catch { } finally { setActing(false); } }

  if (loading && !job) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh" }}><Spin size={24} /></div>;
  if (!job) return <div style={{ padding: 24, color: "#f87171" }}>Job not found.</div>;

  const status = (evt?.status as Job["status"]) || job.status;
  const saved = evt?.records_saved ?? job.records_saved;
  const dupes = evt?.dupes_skipped ?? job.dupes_skipped;
  const pct = evt?.progress_pct ?? job.progress_pct;
  const cur = evt?.current_business ?? job.current_business;
  const isActive = ["running", "queued", "paused", "interrupted"].includes(status);

  return (
    <div className="animate-up" style={{ padding: "24px 28px" }}>
      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
        <Link href="/jobs" style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--text-3)", textDecoration: "none" }}>
          <ArrowLeft size={13} />Jobs
        </Link>
        <span style={{ color: "var(--border)", fontSize: 14 }}>/</span>
        <span style={{ fontSize: 12, color: "var(--text-2)", fontFamily: "'JetBrains Mono',monospace" }}>
          {id.slice(0, 12)}…
        </span>
        <Badge type={statusType(status)} dot={status === "running"} pulse={status === "running"}>
          {status}
        </Badge>
      </div>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "var(--text)", margin: "0 0 6px", letterSpacing: "-.04em" }}>
            {job.search_query || job.category || "Untitled Job"}
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>
            {[job.city, job.state_region, job.country].filter(Boolean).join(", ") || "No location specified"}
          </p>
        </div>
        {isActive && (
          <div style={{ display: "flex", gap: 8 }}>
            {status === "running" && (
              <Btn variant="secondary" size="sm" loading={acting} onClick={() => act(() => pauseJob(id))} icon={<Pause size={12} />}>Pause</Btn>
            )}
            {(status === "paused" || status === "interrupted") && (
              <Btn size="sm" loading={acting} onClick={() => act(() => resumeJob(id))} icon={<Play size={12} />}>Resume</Btn>
            )}
            <Btn variant="danger" size="sm" loading={acting} onClick={() => act(() => cancelJob(id))} icon={<XCircle size={12} />}>Cancel</Btn>
          </div>
        )}
      </div>

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 16 }}>
        {[
          { label: "Progress", value: `${pct}%`, sub: `${job.start_index}–${job.end_index}` },
          { label: "Visited", value: Math.round((pct / 100) * Math.max(job.end_index - job.start_index + 1, 1)).toLocaleString(), sub: "URLs checked" },
          { label: "Saved", value: saved.toLocaleString(), sub: "unique records" },
          { label: "Duplicates", value: dupes.toLocaleString(), sub: "auto-skipped" },
        ].map(({ label, value, sub }) => (
          <div key={label} className="card" style={{ padding: "16px 18px" }}>
            <div className="label" style={{ marginBottom: 8 }}>{label}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", letterSpacing: "-.04em", fontVariantNumeric: "tabular-nums" }}>
              {value}
            </div>
            <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 20 }}>
        <Bar value={pct} color={status === "completed" ? "#22c55e" : status === "failed" ? "#ef4444" : "#6366f1"} h={6} animated={status === "running"} />
        {cur && (
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 8, fontSize: 12, color: "var(--text-3)" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#6366f1", animation: "pulse .9s ease-in-out infinite" }} />
            Currently scraping: <span style={{ color: "var(--text-2)", fontWeight: 500 }}>{cur}</span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "2px solid var(--border2)", marginBottom: 16, gap: 2 }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "8px 16px",
            fontSize: 12, fontWeight: 600, cursor: "pointer",
            background: "transparent", border: "none",
            borderBottom: `2px solid ${tab === t ? "var(--accent)" : "transparent"}`,
            color: tab === t ? "var(--accent)" : "var(--text-3)",
            transition: "all .15s", marginBottom: -2,
          }}>
            {t === "Overview" && <BarChart3 size={12} />}
            {t === "Details" && <FileText size={12} />}
            {t === "Logs" && <Activity size={12} />}
            {t}
          </button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignSelf: "center" }}>
          <Link href={`/results?job_id=${id}`}>
            <Btn variant="secondary" size="xs" icon={<ExternalLink size={11} />}>Results</Btn>
          </Link>
          <Link href={`/logs?job_id=${id}`}>
            <Btn variant="ghost" size="xs" icon={<Activity size={11} />}>Full Logs</Btn>
          </Link>
          <a href={`http://localhost:5000/api/exports/xlsx?job_id=${id}`}>
            <Btn variant="ghost" size="xs" icon={<Download size={11} />}>Export</Btn>
          </a>
        </div>
      </div>

      {/* Overview tab */}
      {tab === "Overview" && (
        <div className="card" style={{ padding: "20px 24px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 40px" }}>
            {([
              ["Status", <Badge key="s" type={statusType(status)} dot={status === "running"} pulse={status === "running"}>{status}</Badge>],
              ["Source", job.source],
              ["Started", fmtDate(job.started_at)],
              ["Finished", fmtDate(job.finished_at)],
              ["Job Limit", job.job_limit],
              ["Daily Limit", job.daily_limit],
            ] as [string, React.ReactNode][]).map(([k, v]) => (
              <div key={String(k)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--border2)" }}>
                <span style={{ fontSize: 12, color: "var(--text-3)" }}>{k}</span>
                <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>{v}</span>
              </div>
            ))}
          </div>
          {job.last_error && (
            <div style={{ marginTop: 16, padding: "10px 14px", borderRadius: 8, background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.2)", fontSize: 12, color: "#f87171" }}>
              <strong>Error:</strong> {job.last_error}
            </div>
          )}
        </div>
      )}

      {/* Details tab */}
      {tab === "Details" && (
        <div className="card" style={{ overflow: "hidden" }}>
          <table className="tbl">
            <tbody>
              {[
                ["Job ID", job.id],
                ["Query", job.search_query || "—"],
                ["Category", job.category || "—"],
                ["Country", job.country || "—"],
                ["State/Region", job.state_region || "—"],
                ["City", job.city || "—"],
                ["Postal Code", job.postal_code || "—"],
                ["Index Range", `${job.start_index} – ${job.end_index}`],
                ["Created", fmtDate(job.created_at)],
                ["Updated", fmtDate(job.updated_at)],
              ].map(([k, v]) => (
                <tr key={k}>
                  <td style={{ width: 180, color: "var(--text-3)", fontWeight: 500, fontSize: 12 }}>{k}</td>
                  <td style={{ color: "var(--text)", fontFamily: k === "Job ID" ? "'JetBrains Mono',monospace" : undefined, fontSize: k === "Job ID" ? 11 : 13 }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Logs tab */}
      {tab === "Logs" && (
        <div style={{ background: "#060b12", border: "1px solid #1a2535", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ padding: "10px 16px", background: "#0d1524", borderBottom: "1px solid #1a2535", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: logState === "streaming" ? "#22c55e" : "#52525b", boxShadow: logState === "streaming" ? "0 0 7px #22c55e" : "none" }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: "#c8d5e8" }}>
                {logState === "streaming" ? "Live" : logState === "done" ? "Ended" : "Connecting…"}
              </span>
              <span style={{ fontSize: 10, color: "#3d5068", marginLeft: 4 }}>{logs.length} events</span>
            </div>
            <Link href={`/logs?job_id=${id}`}>
              <span style={{ fontSize: 11, color: "#6366f1", cursor: "pointer" }}>Full screen →</span>
            </Link>
          </div>
          <div style={{ maxHeight: 380, overflowY: "auto", fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>
            {!logs.length
              ? <div style={{ padding: 32, textAlign: "center", color: "#3d5068" }}>No events yet…</div>
              : [...logs].reverse().slice(0, 40).map((ev, i) => {
                const ts = ev.timestamp || ev.ts || "";
                const col = ev.event_type?.includes("completed") ? "#4ade80" : ev.event_type?.includes("failed") ? "#f87171" : ev.event_type?.includes("saved") ? "#86efac" : "#818cf8";
                return (
                  <div key={ev.id || i} style={{ display: "grid", gridTemplateColumns: "72px 160px 1fr", gap: 10, padding: "5px 16px", borderBottom: "1px solid rgba(26,37,53,.8)" }}>
                    <span style={{ color: "#3d5068", fontVariantNumeric: "tabular-nums" }}>{ts ? new Date(ts).toLocaleTimeString("en-US", { hour12: false }) : "—"}</span>
                    <span style={{ color: col, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.event_type}</span>
                    <span style={{ color: "#8ba0b4" }}>{ev.message}</span>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
