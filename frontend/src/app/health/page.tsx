"use client";
import { useState } from "react";
import { useApi } from "@/hooks/useApi";
import { getHealth, getBackups, createBackup, restoreBackup, type HealthData, type Backup } from "@/lib/api";
import { fmtDate } from "@/lib/utils";
import { Btn, Badge, Spin, Empty, SectionHeader, Bar } from "@/components/ui";
import { RefreshCw, Server, Cpu, Database, Archive, CheckCircle2, AlertTriangle, ShieldCheck, Activity, HardDrive } from "lucide-react";

export default function HealthPage() {
  const { data, loading, error, refresh } = useApi<HealthData>(getHealth, [], { poll: 15000 });
  const { data: backups, refresh: refreshBkp } = useApi<Backup[]>(getBackups);
  const [backing, setBacking] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  async function doBackup() {
    setBacking(true);
    try { await createBackup("manual"); refreshBkp(); }
    finally { setBacking(false); }
  }
  async function doRestore(name: string) {
    if (!confirm(`Restore "${name}"? This will overwrite current data.`)) return;
    setRestoring(name);
    try { await restoreBackup(name); alert("Restore complete — please restart the backend."); }
    finally { setRestoring(null); }
  }

  const allOk = data?.status === "ok" && data?.worker?.status === "ok" && data?.storage === "ok";

  const components = data ? [
    { label: "API Server", detail: `Status: ${data.status}`, icon: Server, ok: data.status === "ok" },
    { label: "Scraper Worker", detail: `PID ${data.worker?.pid ?? "—"} · ${data.worker?.uptime_s ?? 0}s uptime`, icon: Cpu, ok: data.worker?.status === "ok" },
    { label: "Storage", detail: data.storage === "ok" ? "Connected · JSON" : "Error", icon: Database, ok: data.storage === "ok" },
  ] : [];

  return (
    <div className="animate-up" style={{ padding: "24px 28px" }}>
      <SectionHeader
        title="System Health"
        sub="Monitor components and manage data backups"
        action={<Btn variant="ghost" size="sm" icon={<RefreshCw size={13} />} onClick={refresh}>Refresh</Btn>}
      />

      {loading && !data
        ? <div style={{ padding: 80, display: "flex", justifyContent: "center" }}><Spin size={28} /></div>
        : error
          ? <div style={{ padding: "12px 16px", borderRadius: 10, background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.2)", fontSize: 13, color: "#f87171" }}>{error}</div>
          : data && (
            <>
              {/* Overall banner */}
              <div style={{
                padding: "16px 20px", borderRadius: 12, marginBottom: 24,
                display: "flex", alignItems: "center", gap: 14,
                background: allOk ? "rgba(34,197,94,.06)" : "rgba(245,158,11,.06)",
                border: `1px solid ${allOk ? "rgba(34,197,94,.2)" : "rgba(245,158,11,.2)"}`,
              }}>
                {allOk
                  ? <ShieldCheck size={22} color="#4ade80" />
                  : <AlertTriangle size={22} color="#fbbf24" />}
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: allOk ? "#4ade80" : "#fbbf24" }}>
                    {allOk ? "All systems operational" : "Some systems degraded"}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                    Auto-refreshes every 15 seconds
                  </div>
                </div>
                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                  {components.map(c => (
                    <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 7, background: "var(--bg-card2)", border: "1px solid var(--border)" }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.ok ? "#22c55e" : "#ef4444" }} />
                      <span style={{ fontSize: 11, color: "var(--text-2)" }}>{c.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                {/* Components */}
                <div className="card" style={{ overflow: "hidden" }}>
                  <div style={{ padding: "14px 18px", background: "var(--bg-card2)", borderBottom: "1px solid var(--border2)", display: "flex", alignItems: "center", gap: 8 }}>
                    <Activity size={13} color="var(--text-3)" />
                    <span className="label">System Components</span>
                  </div>
                  <div>
                    {components.map(({ label, detail, icon: Icon, ok }) => (
                      <div key={label} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", borderBottom: "1px solid var(--border2)" }}>
                        <div style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, background: ok ? "rgba(34,197,94,.08)" : "rgba(239,68,68,.08)", border: `1px solid ${ok ? "rgba(34,197,94,.18)" : "rgba(239,68,68,.18)"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <Icon size={16} color={ok ? "#4ade80" : "#f87171"} strokeWidth={1.75} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{label}</div>
                          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>{detail}</div>
                        </div>
                        {ok
                          ? <CheckCircle2 size={16} color="#4ade80" />
                          : <AlertTriangle size={16} color="#f87171" />}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Dedup index */}
                <div className="card" style={{ overflow: "hidden" }}>
                  <div style={{ padding: "14px 18px", background: "var(--bg-card2)", borderBottom: "1px solid var(--border2)", display: "flex", alignItems: "center", gap: 8 }}>
                    <HardDrive size={13} color="var(--text-3)" />
                    <span className="label">Dedup Index</span>
                  </div>
                  <div style={{ padding: "18px 20px" }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 32, fontWeight: 900, letterSpacing: "-.05em", color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
                        {(data.dedup_index?.total_fingerprints ?? 0).toLocaleString()}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--text-3)" }}>fingerprints</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginTop: 16 }}>
                      {Object.entries(data.dedup_index?.by_tier || {}).map(([tier, n]) => (
                        <div key={tier} style={{ padding: "10px 12px", borderRadius: 8, background: "var(--bg-card2)", border: "1px solid var(--border2)" }}>
                          <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{(n as number).toLocaleString()}</div>
                          <div style={{ fontSize: 9, color: "var(--text-3)", marginTop: 2, textTransform: "uppercase", letterSpacing: ".07em" }}>{tier}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Backups */}
              <div className="card" style={{ overflow: "hidden" }}>
                <div style={{ padding: "14px 18px", background: "var(--bg-card2)", borderBottom: "1px solid var(--border2)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Archive size={13} color="#a78bfa" />
                    <span className="label">Backups</span>
                  </div>
                  <Btn size="xs" variant="secondary" loading={backing} onClick={doBackup} icon={<Archive size={11} />}>
                    Create Backup
                  </Btn>
                </div>
                {!backups?.length
                  ? <Empty icon={Archive} title="No backups yet" sub="Create one to protect your data" />
                  : (
                    <table className="tbl">
                      <thead><tr><th>Backup Name</th><th>Created</th><th>Size</th><th style={{ width: 90 }}></th></tr></thead>
                      <tbody>
                        {backups.map(b => (
                          <tr key={b.name}>
                            <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "var(--text-2)" }}>{b.name}</td>
                            <td style={{ fontSize: 12, color: "var(--text-2)" }}>{fmtDate(b.created_at)}</td>
                            <td style={{ fontSize: 12, color: "var(--text-3)" }}>{b.size_bytes ? (b.size_bytes / 1024).toFixed(1) + " KB" : "—"}</td>
                            <td>
                              <Btn variant="ghost" size="xs" loading={restoring === b.name} onClick={() => doRestore(b.name)}>
                                Restore
                              </Btn>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
              </div>
            </>
          )}
    </div>
  );
}
