"use client";
import { useState } from "react";
import { useApi } from "@/hooks/useApi";
import { getBusinesses, enrichBusiness, type BusinessesResponse, type Business } from "@/lib/api";
import { Btn, Badge, Spin, Empty, SectionHeader, Bar } from "@/components/ui";
import { Sparkles, CheckCircle2, XCircle, AlertCircle, Zap } from "lucide-react";

type EnrichResult = { id: string; status: "ok" | "error"; msg: string };

export default function EnrichmentPage() {
  const [jobId, setJobId] = useState("");
  const [minQ, setMinQ] = useState("");
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<EnrichResult[]>([]);
  const [running, setRunning] = useState(false);

  const { data, loading } = useApi<BusinessesResponse>(
    () => getBusinesses({ job_id: jobId || undefined, min_quality: minQ ? parseFloat(minQ) : undefined, per_page: 50, page }),
    [jobId, minQ, page],
  );

  async function run() {
    const items = data?.items ?? [];
    if (!items.length) return;
    setRunning(true);
    setResults([]);
    for (const b of items) {
      try {
        await enrichBusiness(b.id);
        setResults(p => [...p, { id: b.id, status: "ok", msg: b.name }]);
      } catch (e) {
        setResults(p => [...p, { id: b.id, status: "error", msg: (e as Error).message }]);
      }
    }
    setRunning(false);
  }

  const done = results.filter(r => r.status === "ok").length;
  const failed = results.filter(r => r.status === "error").length;
  const pct = results.length ? Math.round(results.length / (data?.items.length ?? 1) * 100) : 0;

  return (
    <div className="animate-up" style={{ padding: "24px 28px" }}>
      <SectionHeader
        title="AI Enrichment"
        sub="Enhance business records with AI-generated email guesses and descriptions"
      />

      {/* Info banner */}
      <div style={{ padding: "14px 18px", borderRadius: 10, marginBottom: 24, display: "flex", alignItems: "center", gap: 14, background: "rgba(99,102,241,.06)", border: "1px solid rgba(99,102,241,.15)" }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(99,102,241,.12)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Sparkles size={16} color="#818cf8" />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 2 }}>Powered by Groq AI</div>
          <div style={{ fontSize: 12, color: "var(--text-3)" }}>
            Requires <code style={{ fontSize: 11, background: "rgba(99,102,241,.1)", color: "#a78bfa", padding: "1px 6px", borderRadius: 4 }}>GROQ_API_KEY</code> in your .env file.
            Adds email guesses, descriptions, and tags to records that are missing them.
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 20, alignItems: "start" }}>

        {/* Config panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card" style={{ padding: "20px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>
              Select Records
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label className="label" style={{ display: "block", marginBottom: 6 }}>Filter by Job ID</label>
                <input className="field" placeholder="Leave blank for all jobs" value={jobId} onChange={e => { setJobId(e.target.value); setPage(1); }} />
              </div>
              <div>
                <label className="label" style={{ display: "block", marginBottom: 6 }}>Min Quality Score</label>
                <input className="field" type="number" min={0} max={100} step={10}
                  placeholder="e.g. 40 — enrich below this score" value={minQ} onChange={e => { setMinQ(e.target.value); setPage(1); }} />
              </div>
            </div>
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border2)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "var(--text-3)" }}>
                {loading ? "Loading…" : <><strong style={{ color: "var(--text)" }}>{data?.total ?? 0}</strong> records match</>}
              </span>
            </div>
          </div>

          {/* Action button */}
          <Btn
            size="md"
            loading={running}
            disabled={!data?.items.length || running}
            icon={<Zap size={14} />}
            onClick={run}
            style={{ width: "100%", justifyContent: "center", padding: "10px 0" }}
          >
            {running ? `Enriching ${done + failed}/${data?.items.length ?? 0}…` : `Enrich ${data?.items.length ?? 0} Records`}
          </Btn>

          {/* Progress */}
          {running && (
            <div className="card" style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>Progress</span>
                <span style={{ fontSize: 11, color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>{done + failed}/{data?.items.length ?? 0}</span>
              </div>
              <Bar value={pct} color="#6366f1" h={5} animated />
              <div style={{ display: "flex", gap: 16, marginTop: 10 }}>
                <span style={{ fontSize: 11, color: "#4ade80", fontWeight: 600 }}>✓ {done} enriched</span>
                {failed > 0 && <span style={{ fontSize: 11, color: "#f87171", fontWeight: 600 }}>✗ {failed} failed</span>}
              </div>
            </div>
          )}

          {/* Summary after completion */}
          {!running && results.length > 0 && (
            <div className="card" style={{ padding: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Completed</div>
              <div style={{ display: "flex", gap: 20 }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 24, fontWeight: 800, color: "#4ade80", fontVariantNumeric: "tabular-nums" }}>{done}</div>
                  <div style={{ fontSize: 10, color: "var(--text-3)" }}>Enriched</div>
                </div>
                {failed > 0 && (
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color: "#f87171", fontVariantNumeric: "tabular-nums" }}>{failed}</div>
                    <div style={{ fontSize: 10, color: "var(--text-3)" }}>Failed</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Records preview */}
        <div className="card" style={{ overflow: "hidden" }}>
          {loading
            ? <div style={{ padding: 48, display: "flex", justifyContent: "center" }}><Spin size={22} /></div>
            : !data?.items.length
              ? <Empty icon={Sparkles} title="No records match" sub="Adjust your filters above" />
              : (
                <>
                  <div style={{ padding: "12px 16px", background: "var(--bg-card2)", borderBottom: "1px solid var(--border2)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span className="label">{data.items.length} records to enrich</span>
                    {data.pages > 1 && (
                      <div style={{ display: "flex", gap: 6 }}>
                        <Btn size="xs" variant="secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</Btn>
                        <span style={{ fontSize: 11, color: "var(--text-3)", lineHeight: "24px" }}>{page}/{data.pages}</span>
                        <Btn size="xs" variant="secondary" disabled={page >= data.pages} onClick={() => setPage(p => p + 1)}>Next</Btn>
                      </div>
                    )}
                  </div>
                  <table className="tbl">
                    <thead><tr><th>Business</th><th style={{ textAlign: "center" }}>Quality</th><th>Email</th><th>Result</th></tr></thead>
                    <tbody>
                      {data.items.map((b: Business) => {
                        const r = results.find(x => x.id === b.id);
                        return (
                          <tr key={b.id}>
                            <td style={{ maxWidth: 220 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</div>
                              <div style={{ fontSize: 10, color: "var(--text-3)" }}>{b.city || "—"}</div>
                            </td>
                            <td style={{ textAlign: "center" }}>
                              <span style={{ fontSize: 13, fontWeight: 800, fontVariantNumeric: "tabular-nums", color: b.quality_score >= 80 ? "#4ade80" : b.quality_score >= 60 ? "#fbbf24" : "#f87171" }}>
                                {b.quality_score}
                              </span>
                            </td>
                            <td>
                              {b.email
                                ? <span style={{ fontSize: 11, color: "#4ade80" }}>✓ {b.email}</span>
                                : <span style={{ fontSize: 11, color: "var(--text-3)" }}>—</span>}
                            </td>
                            <td>
                              {r ? (
                                <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: r.status === "ok" ? "#4ade80" : "#f87171" }}>
                                  {r.status === "ok" ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                                  {r.status === "ok" ? "Done" : "Failed"}
                                </span>
                              ) : running ? (
                                <span style={{ fontSize: 11, color: "var(--text-3)", display: "flex", alignItems: "center", gap: 5 }}>
                                  <Spin size={12} />waiting
                                </span>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              )}
        </div>
      </div>
    </div>
  );
}
