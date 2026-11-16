"use client";
import { useState } from "react";
import { useApi } from "@/hooks/useApi";
import { getSchedules, createSchedule, updateSchedule, deleteSchedule, type Schedule } from "@/lib/api";
import { fmtDate } from "@/lib/utils";
import { Btn, Badge, Spin, Empty, SectionHeader } from "@/components/ui";
import { Clock, Plus, Trash2, X, Calendar, Play, Pause, ChevronRight } from "lucide-react";

const PRESETS = [
  { label: "Daily 6 AM", cron: "0 6 * * *" },
  { label: "Every 6 hrs", cron: "0 */6 * * *" },
  { label: "Weekly Mon", cron: "0 9 * * 1" },
  { label: "Every 30 min", cron: "*/30 * * * *" },
];

export default function SchedulesPage() {
  const { data, loading, refresh } = useApi<Schedule[]>(getSchedules);
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", cron: "0 6 * * *", enabled: true });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await createSchedule({ name: form.name, cron: form.cron, enabled: form.enabled });
      setShow(false);
      setForm({ name: "", cron: "0 6 * * *", enabled: true });
      refresh();
    } finally { setSaving(false); }
  }
  async function toggle(s: Schedule) { await updateSchedule(s.id, { enabled: !s.enabled }); refresh(); }
  async function del(id: string) { if (!confirm("Delete this schedule?")) return; await deleteSchedule(id); refresh(); }

  return (
    <div className="animate-up" style={{ padding: "24px 28px" }}>
      <SectionHeader
        title="Schedules"
        sub="Automate recurring scrape jobs with cron expressions"
        action={
          <Btn size="sm" icon={show ? <X size={12} /> : <Plus size={12} />} onClick={() => setShow(v => !v)}>
            {show ? "Cancel" : "New Schedule"}
          </Btn>
        }
      />

      {/* Create form */}
      {show && (
        <div className="card" style={{ padding: "22px 24px", marginBottom: 20, border: "1px solid rgba(99,102,241,.25)", boxShadow: "0 0 0 1px rgba(99,102,241,.1)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(99,102,241,.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Calendar size={14} color="var(--accent)" />
            </div>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>New Schedule</span>
          </div>
          <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <label className="label" style={{ display: "block", marginBottom: 6 }}>Name *</label>
                <input className="field" required placeholder="e.g. Daily NYC restaurants"
                  value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <label className="label" style={{ display: "block", marginBottom: 6 }}>Cron Expression</label>
                <input className="field" placeholder="0 6 * * *"
                  value={form.cron} onChange={e => setForm(p => ({ ...p, cron: e.target.value }))}
                  style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }} />
              </div>
            </div>
            {/* Presets */}
            <div>
              <label className="label" style={{ display: "block", marginBottom: 8 }}>Quick Presets</label>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                {PRESETS.map(p => (
                  <button key={p.cron} type="button" onClick={() => setForm(v => ({ ...v, cron: p.cron }))}
                    style={{
                      padding: "5px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
                      background: form.cron === p.cron ? "rgba(99,102,241,.12)" : "var(--bg-card2)",
                      color: form.cron === p.cron ? "#818cf8" : "var(--text-3)",
                      border: `1px solid ${form.cron === p.cron ? "rgba(99,102,241,.3)" : "var(--border)"}`,
                      transition: "all .15s",
                    }}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            {/* Toggle */}
            <label style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
              <div
                onClick={() => setForm(p => ({ ...p, enabled: !p.enabled }))}
                style={{ width: 38, height: 22, borderRadius: 99, position: "relative", cursor: "pointer", transition: "background .2s", background: form.enabled ? "var(--accent)" : "var(--bg-card2)", border: `1px solid ${form.enabled ? "var(--accent)" : "var(--border)"}` }}>
                <div style={{ position: "absolute", width: 16, height: 16, borderRadius: "50%", background: "#fff", top: 2, left: form.enabled ? 18 : 2, transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,.3)" }} />
              </div>
              <span style={{ fontSize: 13, color: "var(--text-2)" }}>Enable immediately</span>
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Btn variant="secondary" size="sm" type="button" onClick={() => setShow(false)}>Cancel</Btn>
              <Btn size="sm" type="submit" loading={saving} icon={<Calendar size={12} />}>Save Schedule</Btn>
            </div>
          </form>
        </div>
      )}

      {/* Schedules table */}
      <div className="card" style={{ overflow: "hidden" }}>
        {loading && !data
          ? <div style={{ padding: 48, display: "flex", justifyContent: "center" }}><Spin size={22} /></div>
          : !data?.length
            ? <Empty icon={Clock} title="No schedules yet" sub="Create a schedule to run scrapes automatically"
              action={<Btn size="sm" icon={<Plus size={12} />} onClick={() => setShow(true)}>Create Schedule</Btn>} />
            : (
              <table className="tbl">
                <thead>
                  <tr><th>Name</th><th>Cron</th><th>Next Run</th><th>Last Run</th><th>Runs</th><th>Status</th><th style={{ width: 90 }}></th></tr>
                </thead>
                <tbody>
                  {data.map((s: Schedule) => (
                    <tr key={s.id}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 30, height: 30, borderRadius: 8, background: s.enabled ? "rgba(99,102,241,.1)" : "var(--bg-card2)", border: `1px solid ${s.enabled ? "rgba(99,102,241,.2)" : "var(--border)"}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <Clock size={13} color={s.enabled ? "#818cf8" : "var(--text-3)"} />
                          </div>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{s.name}</span>
                        </div>
                      </td>
                      <td>
                        <code style={{ fontSize: 11, fontFamily: "'JetBrains Mono',monospace", color: "var(--text-2)", background: "var(--bg-card2)", padding: "2px 8px", borderRadius: 4 }}>
                          {s.cron}
                        </code>
                      </td>
                      <td><span style={{ fontSize: 12, color: "var(--text-2)" }}>{fmtDate(s.next_run)}</span></td>
                      <td><span style={{ fontSize: 12, color: "var(--text-3)" }}>{fmtDate(s.last_run)}</span></td>
                      <td><span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{s.run_count}</span></td>
                      <td>
                        <Badge type={s.enabled ? "green" : "gray"}>
                          {s.enabled ? "Active" : "Disabled"}
                        </Badge>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 5, justifyContent: "flex-end" }}>
                          <button onClick={() => toggle(s)} title={s.enabled ? "Disable" : "Enable"}
                            style={{ width: 26, height: 26, borderRadius: 6, background: s.enabled ? "rgba(245,158,11,.1)" : "rgba(34,197,94,.1)", border: `1px solid ${s.enabled ? "rgba(245,158,11,.2)" : "rgba(34,197,94,.2)"}`, color: s.enabled ? "#fbbf24" : "#4ade80", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {s.enabled ? <Pause size={11} /> : <Play size={11} />}
                          </button>
                          <button onClick={() => del(s.id)} title="Delete"
                            style={{ width: 26, height: 26, borderRadius: 6, background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.2)", color: "#f87171", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
      </div>
    </div>
  );
}
