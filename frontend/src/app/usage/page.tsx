"use client";
import { useApi } from "@/hooks/useApi";
import { getDashboard, type DashboardData } from "@/lib/api";
import { StatCard, Bar, Spin, SectionHeader } from "@/components/ui";
import { Building2, BarChart3, Zap, Clock, RefreshCw, TrendingUp } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  completed: "#22c55e", running: "#6366f1", queued: "#f59e0b",
  failed: "#ef4444", cancelled: "#52525b", paused: "#f97316", interrupted: "#a855f7",
};

export default function UsagePage() {
  const { data, loading, refresh } = useApi<DashboardData>(getDashboard, [], { poll: 30000 });

  const q = data?.today_quota;
  const qPct = q?.limit ? Math.round(q.used / q.limit * 100) : 0;
  const sc = data?.job_status_counts ?? {};
  const tot = data?.total_jobs ?? 0;
  const done = sc["completed"] ?? 0;
  const fail = sc["failed"] ?? 0;
  const rate = done + fail > 0 ? Math.round(done / (done + fail) * 100) : 0;

  return (
    <div className="animate-up" style={{ padding: "24px 28px" }}>
      <SectionHeader
        title="Usage & Analytics"
        sub="Quota consumption, job statistics, and data quality metrics"
        action={<button onClick={refresh} style={{ width: 32, height: 32, borderRadius: 8, background: "var(--bg-card2)", border: "1px solid var(--border)", color: "var(--text-3)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><RefreshCw size={13} /></button>}
      />

      {loading && !data
        ? <div style={{ padding: 80, display: "flex", justifyContent: "center" }}><Spin size={28} /></div>
        : (
          <>
            {/* KPI row */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 24 }}>
              <StatCard label="Total Businesses" value={(data?.total_businesses ?? 0).toLocaleString()} icon={Building2} accent="blue" />
              <StatCard label="Total Jobs" value={tot.toLocaleString()} icon={BarChart3} accent="green" />
              <StatCard label="Success Rate" value={`${rate}%`} icon={Zap} accent={rate >= 80 ? "green" : "amber"}
                sub={`${done} done · ${fail} failed`} />
              <StatCard label="Active Now" value={(sc["running"] ?? 0).toString()} icon={Clock} accent="purple"
                sub={`${sc["queued"] ?? 0} queued`} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              {/* Daily quota */}
              <div className="card" style={{ padding: "22px 24px" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 20 }}>Today&apos;s Quota</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 14 }}>
                  <span style={{ fontSize: 36, fontWeight: 900, letterSpacing: "-.06em", color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
                    {q?.used?.toLocaleString() ?? 0}
                  </span>
                  <span style={{ fontSize: 14, color: "var(--text-3)" }}>/ {q?.limit?.toLocaleString() ?? 0}</span>
                </div>
                <Bar value={qPct} color={qPct > 80 ? "#ef4444" : qPct > 60 ? "#f59e0b" : "#6366f1"} h={6} />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
                  <span style={{ fontSize: 12, color: "var(--text-3)" }}>{qPct}% consumed</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#22c55e" }}>{(q?.remaining ?? 0).toLocaleString()} remaining</span>
                </div>
                {q?.exhausted && (
                  <div style={{ marginTop: 14, padding: "10px 12px", borderRadius: 8, background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.2)", fontSize: 12, color: "#f87171" }}>
                    Daily quota exhausted — saves paused until midnight UTC
                  </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border2)" }}>
                  {[{ l: "Used", v: q?.used ?? 0 }, { l: "Remaining", v: q?.remaining ?? 0 }, { l: "Limit", v: q?.limit ?? 0 }].map(({ l, v }) => (
                    <div key={l} style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{v.toLocaleString()}</div>
                      <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>{l}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Job breakdown */}
              <div className="card" style={{ padding: "22px 24px" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 20 }}>Job Breakdown</div>
                {!tot
                  ? <div style={{ fontSize: 12, color: "var(--text-3)", textAlign: "center", padding: "32px 0" }}>No jobs yet</div>
                  : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      {Object.entries(sc)
                        .sort(([, a], [, b]) => (b as number) - (a as number))
                        .map(([status, count]) => {
                          const pct = Math.round((count as number) / tot * 100);
                          const color = STATUS_COLORS[status] ?? "#52525b";
                          return (
                            <div key={status}>
                              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
                                  <span style={{ fontSize: 12, color: "var(--text-2)", textTransform: "capitalize" }}>{status}</span>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{(count as number).toLocaleString()}</span>
                                  <span style={{ fontSize: 10, color: "var(--text-3)", width: 32, textAlign: "right" }}>{pct}%</span>
                                </div>
                              </div>
                              <Bar value={pct} color={color} h={3} />
                            </div>
                          );
                        })}
                    </div>
                  )}
              </div>
            </div>

            {/* Success rate */}
            <div className="card" style={{ padding: "22px 24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 48, height: 48, borderRadius: 12, background: rate >= 80 ? "rgba(34,197,94,.1)" : "rgba(245,158,11,.1)", border: `1px solid ${rate >= 80 ? "rgba(34,197,94,.2)" : "rgba(245,158,11,.2)"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <TrendingUp size={20} color={rate >= 80 ? "#4ade80" : "#fbbf24"} />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Scraping Success Rate</div>
                  <div style={{ fontSize: 12, color: "var(--text-3)" }}>Based on {done + fail} completed jobs</div>
                </div>
                <div style={{ marginLeft: "auto", fontSize: 36, fontWeight: 900, letterSpacing: "-.05em", color: rate >= 80 ? "#4ade80" : "#fbbf24", fontVariantNumeric: "tabular-nums" }}>
                  {rate}%
                </div>
              </div>
              <div style={{ marginTop: 16 }}>
                <Bar value={rate} color={rate >= 80 ? "#22c55e" : "#f59e0b"} h={6} />
              </div>
            </div>
          </>
        )}
    </div>
  );
}
