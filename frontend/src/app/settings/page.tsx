"use client";
import { useEffect, useState } from "react";
import { useApi } from "@/hooks/useApi";
import { getSettings, updateSettings } from "@/lib/api";
import { Btn, Spin, SectionHeader } from "@/components/ui";
import { Settings, Cpu, Info, CheckCircle2 } from "lucide-react";

const SCRAPER_FIELDS = [
  { k: "default_daily_limit", label: "Daily Record Limit", type: "number", hint: "Max records saved per day across all jobs" },
  { k: "default_job_limit", label: "Job Record Limit", type: "number", hint: "Max records per single job" },
  { k: "max_concurrent_jobs", label: "Max Concurrent Jobs", type: "number", hint: "How many jobs can run in parallel" },
  { k: "request_delay_ms", label: "Request Delay (ms)", type: "number", hint: "Delay between page navigations" },
  { k: "page_load_timeout_ms", label: "Page Load Timeout (ms)", type: "number", hint: "Abort if page doesn't load in time" },
  { k: "chromium_executable_path", label: "Chromium Path", type: "text", hint: "Leave blank to use bundled Playwright Chromium" },
];

const SYS_INFO = [
  ["Application Version", "1.0.0"],
  ["Node.js Version", "22.23.2"],
  ["Python Version", "3.14.6"],
  ["Playwright Version", "1.48.2"],
  ["Data Storage", "JSON Flat-file"],
  ["Storage Path", "./storage"],
];

const TABS = [
  { id: "account", label: "System Info", icon: Info },
  { id: "scraper", label: "Scraper Settings", icon: Cpu },
];

export default function SettingsPage() {
  const [tab, setTab] = useState("account");
  const { data, loading } = useApi<Record<string, unknown>>(getSettings);
  const [local, setLocal] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { if (data) setLocal(data); }, [data]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await updateSettings(local);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally { setSaving(false); }
  }

  return (
    <div className="animate-up" style={{ padding: "24px 28px" }}>
      <SectionHeader title="Settings" sub="Configure your scraper preferences" />

      <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
        {/* Sidebar tabs */}
        <div style={{ width: 190, flexShrink: 0 }}>
          <div className="card" style={{ padding: 6 }}>
            {TABS.map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setTab(id)} style={{
                display: "flex", alignItems: "center", gap: 10,
                width: "100%", padding: "9px 12px", borderRadius: 7,
                background: tab === id ? "rgba(99,102,241,.1)" : "transparent",
                border: "none", color: tab === id ? "#818cf8" : "var(--text-2)",
                fontSize: 13, fontWeight: tab === id ? 600 : 400,
                cursor: "pointer", textAlign: "left", marginBottom: 2,
                transition: "all .15s",
              }}>
                <Icon size={14} strokeWidth={tab === id ? 2.2 : 1.75} />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1 }}>
          {tab === "account" && (
            <div className="card" style={{ overflow: "hidden" }}>
              <div style={{ padding: "16px 20px", background: "var(--bg-card2)", borderBottom: "1px solid var(--border2)" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>System Information</div>
                <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>Read-only runtime details</div>
              </div>
              <div style={{ padding: "4px 0" }}>
                {SYS_INFO.map(([k, v]) => (
                  <div key={k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 20px", borderBottom: "1px solid var(--border2)" }}>
                    <span style={{ fontSize: 13, color: "var(--text-2)" }}>{k}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", fontFamily: v.match(/^\d/) || v.includes(".") || v.includes("/") ? "'JetBrains Mono',monospace" : undefined }}>
                      {v}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === "scraper" && (
            loading
              ? <div style={{ padding: 48, display: "flex", justifyContent: "center" }}><Spin size={24} /></div>
              : (
                <form onSubmit={save}>
                  <div className="card" style={{ overflow: "hidden", marginBottom: 14 }}>
                    <div style={{ padding: "16px 20px", background: "var(--bg-card2)", borderBottom: "1px solid var(--border2)", display: "flex", alignItems: "center", gap: 8 }}>
                      <Cpu size={14} color="var(--accent)" />
                      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Scraper Configuration</div>
                    </div>
                    <div style={{ padding: "20px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                      {SCRAPER_FIELDS.map(({ k, label, type, hint }) => (
                        <div key={k} style={k === "chromium_executable_path" ? { gridColumn: "1/-1" } : {}}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7 }}>
                            <label className="label">{label}</label>
                            {hint && <span title={hint} style={{ cursor: "help" }}>
                              <Info size={10} color="var(--text-3)" />
                            </span>}
                          </div>
                          <input
                            className="field"
                            type={type}
                            min={type === "number" ? 0 : undefined}
                            value={(local[k] ?? "") as string}
                            onChange={e => setLocal(p => ({ ...p, [k]: type === "number" ? parseInt(e.target.value) : e.target.value }))}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                    {saved && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#4ade80" }}>
                        <CheckCircle2 size={14} />
                        Settings saved!
                      </div>
                    )}
                    <Btn type="submit" size="sm" loading={saving} icon={<Settings size={12} />}>
                      Save Changes
                    </Btn>
                  </div>
                </form>
              )
          )}
        </div>
      </div>
    </div>
  );
}
