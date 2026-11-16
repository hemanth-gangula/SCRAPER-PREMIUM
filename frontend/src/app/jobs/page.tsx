"use client";
import { useState } from "react";
import Link from "next/link";
import { useApi } from "@/hooks/useApi";
import { getJobs, pauseJob, resumeJob, cancelJob, type Job } from "@/lib/api";
import { fmtAgo } from "@/lib/utils";
import { Badge, Btn, Bar, Spin, Empty, SectionHeader } from "@/components/ui";
import { Briefcase, Plus, RefreshCw, Activity, Play, Pause, XCircle, ChevronRight, Search } from "lucide-react";

function statusType(s: string): "blue" | "green" | "amber" | "red" | "purple" | "gray" {
  return s === "running" ? "blue" : s === "completed" ? "green" : s === "queued" ? "amber"
    : s === "failed" ? "red" : s === "paused" ? "purple" : "gray";
}
function statusDot(s: string) {
  return s === "running" ? "#6366f1" : s === "completed" ? "#22c55e" : s === "failed" ? "#ef4444"
    : s === "queued" ? "#f59e0b" : "#52525b";
}

const TABS = ["All", "Running", "Queued", "Completed", "Failed", "Paused"];

export default function JobsPage() {
  const [tab, setTab] = useState("All");
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const status = tab === "All" ? undefined : tab.toLowerCase();
  const { data, loading, error, refresh } = useApi(() => getJobs(page, status), [page, tab], { poll: 5000 });

  async function act(fn: () => Promise<Job>) { try { await fn(); refresh(); } catch { } }

  const items = (data?.items ?? []).filter(j =>
    !q || j.search_query?.toLowerCase().includes(q.toLowerCase()) || j.category?.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="animate-up" style={{ padding: "24px 28px" }}>
      <SectionHeader
        title="Jobs"
        sub={`${data?.total ?? 0} total jobs`}
        action={<>
          <Btn variant="ghost" size="sm" onClick={refresh} icon={<RefreshCw size={13} />} />
          <Link href="/scraper"><Btn size="sm" icon={<Plus size={13} />}>New Job</Btn></Link>
        </>}
      />

      {/* Tabs + search bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12 }}>
        <div style={{ display: "flex", gap: 1, borderBottom: "2px solid var(--border2)", position: "relative" }}>
          {TABS.map(t => (
            <button key={t} onClick={() => { setTab(t); setPage(1); }} style={{
              padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer",
              background: "transparent", border: "none",
              borderBottom: `2px solid ${tab === t ? "var(--accent)" : "transparent"}`,
              color: tab === t ? "var(--accent)" : "var(--text-3)",
              transition: "all .15s", marginBottom: -2,
            }}>{t}</button>
          ))}
        </div>
        <div style={{ position: "relative", width: 220 }}>
          <Search size={12} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--text-3)" }} />
          <input className="field" style={{ paddingLeft: 28, height: 30, fontSize: 12 }}
            placeholder="Search jobs…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
      </div>

      {error && (
        <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.2)", fontSize: 12, color: "#f87171", marginBottom: 14 }}>
          {error}
        </div>
      )}

      <div className="card" style={{ overflow: "hidden" }}>
        {loading && !data
          ? <div style={{ padding: 48, display: "flex", justifyContent: "center" }}><Spin size={24} /></div>
          : !items.length
            ? <Empty icon={Briefcase} title="No jobs found" sub="Start a new scrape to see jobs here"
              action={<Link href="/scraper"><Btn size="sm" icon={<Plus size={12} />}>New Scrape</Btn></Link>} />
            : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 16 }}></th>
                    <th>Job</th>
                    <th>Location</th>
                    <th>Status</th>
                    <th style={{ width: 120 }}>Progress</th>
                    <th>Saved</th>
                    <th>Limit</th>
                    <th>Created</th>
                    <th style={{ width: 80 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((j: Job) => (
                    <tr key={j.id}>
                      <td>
                        <span style={{
                          display: "block", width: 7, height: 7, borderRadius: "50%",
                          background: statusDot(j.status),
                          boxShadow: j.status === "running" ? `0 0 8px ${statusDot(j.status)}` : undefined,
                        }} />
                      </td>
                      <td>
                        <Link href={`/jobs/${j.id}`} style={{ textDecoration: "none" }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {j.search_query || j.category || "Untitled"}
                          </div>
                          <div style={{ fontSize: 10, color: "var(--text-3)", fontFamily: "'JetBrains Mono',monospace", marginTop: 2 }}>
                            {j.id.slice(0, 8)}…
                          </div>
                        </Link>
                      </td>
                      <td>
                        <span style={{ fontSize: 12, color: "var(--text-2)" }}>
                          {[j.city, j.country].filter(Boolean).join(", ") || "—"}
                        </span>
                      </td>
                      <td>
                        <Badge type={statusType(j.status)} dot={j.status === "running"} pulse={j.status === "running"}>
                          {j.status}
                        </Badge>
                      </td>
                      <td>
                        <Bar value={j.progress_pct} color={j.status === "completed" ? "#22c55e" : j.status === "running" ? "#6366f1" : "#52525b"} h={3} animated={j.status === "running"} />
                        <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
                          {j.progress_pct}%
                        </div>
                      </td>
                      <td>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
                          {j.records_saved}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: 11, color: "var(--text-3)" }}>{j.job_limit}</span>
                      </td>
                      <td>
                        <span style={{ fontSize: 11, color: "var(--text-3)" }}>{fmtAgo(j.created_at)}</span>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                          <Link href={`/logs?job_id=${j.id}`} title="Logs">
                            <button style={{ width: 26, height: 26, borderRadius: 6, background: "var(--bg-card2)", border: "1px solid var(--border)", color: "var(--text-3)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <Activity size={12} />
                            </button>
                          </Link>
                          {j.status === "running" && (
                            <button onClick={() => act(() => pauseJob(j.id))} title="Pause" style={{ width: 26, height: 26, borderRadius: 6, background: "rgba(245,158,11,.1)", border: "1px solid rgba(245,158,11,.2)", color: "#fbbf24", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <Pause size={11} />
                            </button>
                          )}
                          {(j.status === "paused" || j.status === "interrupted") && (
                            <button onClick={() => act(() => resumeJob(j.id))} title="Resume" style={{ width: 26, height: 26, borderRadius: 6, background: "rgba(99,102,241,.1)", border: "1px solid rgba(99,102,241,.2)", color: "#818cf8", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <Play size={11} />
                            </button>
                          )}
                          {!["completed", "cancelled", "failed"].includes(j.status) && (
                            <button onClick={() => act(() => cancelJob(j.id))} title="Cancel" style={{ width: 26, height: 26, borderRadius: 6, background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.2)", color: "#f87171", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <XCircle size={11} />
                            </button>
                          )}
                          <Link href={`/jobs/${j.id}`}>
                            <button style={{ width: 26, height: 26, borderRadius: 6, background: "var(--bg-card2)", border: "1px solid var(--border)", color: "var(--text-3)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <ChevronRight size={12} />
                            </button>
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
        }
      </div>

      {data && data.pages > 1 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>
            Page {page} of {data.pages} · {data.total} jobs
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <Btn variant="secondary" size="xs" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</Btn>
            <Btn variant="secondary" size="xs" disabled={page >= data.pages} onClick={() => setPage(p => p + 1)}>Next →</Btn>
          </div>
        </div>
      )}
    </div>
  );
}
