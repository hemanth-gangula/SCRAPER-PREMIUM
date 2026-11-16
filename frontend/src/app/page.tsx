"use client";
import Link from "next/link";
import { useState } from "react";
import { useApi } from "@/hooks/useApi";
import {
  getDashboard, getHealth, getJobs, getBusinessCoverage,
  type DashboardData, type HealthData, type JobsResponse, type CoverageStats,
} from "@/lib/api";
import { fmtAgo } from "@/lib/utils";
import { StatCard, Badge, Btn, Bar, Spin } from "@/components/ui";
import {
  Building2, Database, Fingerprint, Phone, Zap, ArrowRight,
  RefreshCw, TrendingUp, Mail, Globe, CheckCircle,
} from "lucide-react";

function statusColor(s: string) {
  return s === "running" ? "#6366f1" : s === "completed" ? "#22c55e" : s === "failed" ? "#ef4444" : s === "queued" ? "#f59e0b" : "#52525b";
}
function statusType(s: string): "blue" | "green" | "amber" | "red" | "purple" | "gray" {
  return s === "running" ? "blue" : s === "completed" ? "green" : s === "queued" ? "amber" : s === "failed" ? "red" : s === "paused" ? "purple" : "gray";
}

function MiniChart({ jobs, days }: { jobs: JobsResponse | null; days: number }) {
  if (!jobs?.items.length) {
    return (
      <div style={{ height: 80, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>No data yet</span>
      </div>
    );
  }
  const now = Date.now();
  const buckets = new Map<string, number>();
  for (let d = days - 1; d >= 0; d--) {
    const dt = new Date(now - d * 86400000);
    buckets.set(dt.toLocaleDateString("en-US", { month: "short", day: "numeric" }), 0);
  }
  for (const j of jobs.items) {
    const t = new Date(j.created_at).getTime();
    if (t < now - days * 86400000) continue;
    const k = new Date(j.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    buckets.set(k, (buckets.get(k) ?? 0) + j.records_saved);
  }
  const vals = [...buckets.values()];
  const mx = Math.max(...vals, 1);
  const W = 500; const H = 80; const P = 2;
  const pts = vals.map((v, i) => `${(i / Math.max(vals.length - 1, 1)) * W},${H - P - (v / mx) * (H - P * 2)}`).join(" ");
  const areaPath = `M0,${H} L${pts.split(" ").map((p, i) => i === 0 ? `0,${p.split(",")[1]}` : p).join(" L")} L${W},${H} Z`;
  const labels = [...buckets.keys()].filter((_, i, a) => i === 0 || i === Math.floor(a.length / 2) || i === a.length - 1);

  return (
    <>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block" }}>
        <defs>
          <linearGradient id="dg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366f1" stopOpacity=".3" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[H * .3, H * .6, H * .9].map(y => <line key={y} x1="0" y1={y} x2={W} y2={y} stroke="rgba(255,255,255,.04)" strokeWidth="1" />)}
        <path d={areaPath} fill="url(#dg)" />
        <polyline points={pts} fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {vals.length > 0 && (() => {
          const last = pts.split(" ").pop()!.split(",");
          return <circle cx={last[0]} cy={last[1]} r="3.5" fill="#6366f1" stroke="#09090b" strokeWidth="2" />;
        })()}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
        {labels.map(l => <span key={l} style={{ fontSize: 9, color: "var(--text-3)" }}>{l}</span>)}
      </div>
    </>
  );
}

export default function Dashboard() {
  const [range, setRange] = useState<"7D" | "30D">("7D");
  const { data: d, loading, refresh } = useApi<DashboardData>(getDashboard, [], { poll: 10000 });
  const { data: h } = useApi<HealthData>(getHealth, [], { poll: 15000 });
  const { data: jobs } = useApi<JobsResponse>(() => getJobs(1), [], { poll: 10000 });
  const { data: cov } = useApi<CoverageStats>(getBusinessCoverage, [], { poll: 15000 });

  if (loading && !d) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh" }}>
      <Spin size={28} />
    </div>
  );
  if (!d) return null;

  const q = d.today_quota;
  const qPct = q?.limit ? Math.round(q.used / q.limit * 100) : 0;
  const sc = d.job_status_counts || {};
  const tiers = h?.dedup_index?.by_tier || {};
  const totalBiz = cov?.total ?? d.total_businesses;

  return (
    <div className="animate-up" style={{ padding: "24px 28px" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", margin: 0, letterSpacing: "-.05em" }}>
            Dashboard
          </h1>
          <p style={{ fontSize: 12, color: "var(--text-3)", margin: "4px 0 0" }}>
            Monitor your scraping activity and data
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn variant="ghost" size="sm" onClick={refresh} icon={<RefreshCw size={13} />}>Refresh</Btn>
          <Link href="/scraper">
            <Btn size="sm" icon={<Zap size={13} />}>New Scrape</Btn>
          </Link>
        </div>
      </div>

      {/* ── KPI row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 24 }}>
        <StatCard label="Total Businesses" value={totalBiz.toLocaleString()} icon={Building2} accent="blue" sub={`${d.dedup_fingerprints.toLocaleString()} fingerprints`} />
        <StatCard label="Records Saved" value={d.total_saved?.toLocaleString() ?? "—"} icon={Database} accent="green" sub="all-time" />
        <StatCard label="Dupes Skipped" value={d.total_dupes_skipped?.toLocaleString() ?? "—"} icon={Fingerprint} accent="amber" sub="auto-deduplicated" />
        <StatCard label="With Phone" value={(cov?.with_phone ?? 0).toLocaleString()} icon={Phone} accent="purple"
          sub={totalBiz > 0 ? `${Math.round((cov?.with_phone ?? 0) / totalBiz * 100)}% coverage` : "—"} />
      </div>

      {/* ── Chart + Recent jobs ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 16, marginBottom: 16 }}>

        {/* Activity chart */}
        <div className="card" style={{ padding: "20px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Scraping Activity</div>
              <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>Records saved per day</div>
            </div>
            <div style={{ display: "flex", background: "var(--bg-card2)", borderRadius: 7, padding: 2, border: "1px solid var(--border)" }}>
              {(["7D", "30D"] as const).map(r => (
                <button key={r} onClick={() => setRange(r)} style={{
                  padding: "4px 10px", borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: "pointer",
                  border: "none", transition: "all .15s",
                  background: r === range ? "var(--accent)" : "transparent",
                  color: r === range ? "#fff" : "var(--text-3)",
                }}>{r}</button>
              ))}
            </div>
          </div>
          <MiniChart jobs={jobs} days={range === "7D" ? 7 : 30} />
        </div>

        {/* Recent jobs */}
        <div className="card" style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--border2)" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Recent Jobs</div>
            <Link href="/jobs">
              <Btn variant="ghost" size="xs" iconRight={<ArrowRight size={10} />}>View all</Btn>
            </Link>
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {!d.recent_jobs?.length
              ? <div style={{ padding: "32px 20px", textAlign: "center", fontSize: 12, color: "var(--text-3)" }}>
                No jobs yet — <Link href="/scraper" style={{ color: "var(--accent)", textDecoration: "none" }}>start scraping</Link>
              </div>
              : d.recent_jobs.slice(0, 6).map(j => (
                <Link key={j.id} href={`/jobs/${j.id}`} style={{ textDecoration: "none" }}>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 20px", borderBottom: "1px solid var(--border2)", cursor: "pointer", transition: "background .1s" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-hover)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    <div style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: statusColor(j.status), boxShadow: j.status === "running" ? `0 0 7px ${statusColor(j.status)}` : undefined }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {j.search_query || j.category || "Untitled"}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--text-3)" }}>
                        {[j.city, j.country].filter(Boolean).join(", ") || "—"} · {fmtAgo(j.created_at)}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{j.records_saved}</div>
                      <Badge type={statusType(j.status)} dot={j.status === "running"} pulse={j.status === "running"}>{j.status}</Badge>
                    </div>
                  </div>
                </Link>
              ))
            }
          </div>
        </div>
      </div>

      {/* ── Bottom row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>

        {/* Worker status */}
        <div className="card" style={{ padding: "20px" }}>
          <div className="label" style={{ marginBottom: 14 }}>Worker Status</div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <div style={{ position: "relative", width: 36, height: 36 }}>
              <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: d.worker_status === "ok" ? "rgba(34,197,94,.12)" : "rgba(239,68,68,.12)", border: `1px solid ${d.worker_status === "ok" ? "rgba(34,197,94,.2)" : "rgba(239,68,68,.2)"}` }} />
              <div style={{ position: "absolute", inset: "28%", borderRadius: "50%", background: d.worker_status === "ok" ? "#22c55e" : "#ef4444", boxShadow: d.worker_status === "ok" ? "0 0 8px #22c55e" : "none" }} />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
                {d.worker_status === "ok" ? "Online" : "Offline"}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                {sc.running ?? 0} running · {sc.queued ?? 0} queued
              </div>
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {Object.entries(sc).map(([s, n]) => (
              <Badge key={s} type={statusType(s)} dot={s === "running"} pulse={s === "running"}>
                {s} {n as number}
              </Badge>
            ))}
            {!Object.keys(sc).length && <span style={{ fontSize: 11, color: "var(--text-3)" }}>No jobs yet</span>}
          </div>
        </div>

        {/* Daily quota */}
        <div className="card" style={{ padding: "20px" }}>
          <div className="label" style={{ marginBottom: 14 }}>Daily Quota</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 12 }}>
            <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-.05em", color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
              {q?.used?.toLocaleString() ?? 0}
            </span>
            <span style={{ fontSize: 12, color: "var(--text-3)" }}>/ {q?.limit?.toLocaleString() ?? 0}</span>
          </div>
          <Bar value={qPct} color={qPct > 80 ? "#ef4444" : qPct > 60 ? "#f59e0b" : "#6366f1"} h={5} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11 }}>
            <span style={{ color: "var(--text-3)" }}>{qPct}% used</span>
            <span style={{ color: "#22c55e", fontWeight: 600 }}>{(q?.remaining ?? 0).toLocaleString()} left</span>
          </div>
          {totalBiz > 0 && (
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border2)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {[
                { label: "Phone", value: cov?.with_phone ?? 0, icon: Phone, color: "#6366f1" },
                { label: "Email", value: cov?.with_email ?? 0, icon: Mail, color: "#22c55e" },
                { label: "Website", value: cov?.with_website ?? 0, icon: Globe, color: "#f59e0b" },
                { label: "Total", value: totalBiz, icon: CheckCircle, color: "#a855f7" },
              ].map(({ label, value, icon: Icon, color }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <Icon size={12} color={color} />
                  <div>
                    <div style={{ fontSize: 9, color: "var(--text-3)" }}>{label}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
                      {value.toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Dedup index */}
        <div className="card" style={{ padding: "20px" }}>
          <div className="label" style={{ marginBottom: 14 }}>Dedup Index</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-.05em", color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
              {d.dedup_fingerprints.toLocaleString()}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, color: "#22c55e", fontWeight: 600 }}>
              <TrendingUp size={11} />active
            </span>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 16 }}>unique fingerprints indexed</div>
          {Object.keys(tiers).length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px" }}>
              {Object.entries(tiers).map(([tier, count]) => (
                <div key={tier} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ fontSize: 9, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: ".07em" }}>{tier}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
                    {(count as number).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: "var(--text-3)", textAlign: "center", padding: "12px 0" }}>
              No fingerprints yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
