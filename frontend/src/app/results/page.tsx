"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useApi } from "@/hooks/useApi";
import { getBusinesses, exportUrl, type Business, type BusinessFilters } from "@/lib/api";
import { Btn, Badge, Bar, Spin, Empty, SectionHeader } from "@/components/ui";
import {
  Building2, Search, Download, RefreshCw, Phone, Globe,
  Star, ExternalLink, SlidersHorizontal, X, Mail,
} from "lucide-react";

const Q_COLOR = (n: number) => n >= 80 ? "#4ade80" : n >= 60 ? "#fbbf24" : "#f87171";
const Q_TYPE = (n: number): "green" | "amber" | "red" => n >= 80 ? "green" : n >= 60 ? "amber" : "red";

const CAT_OPTS = [
  { value: "", label: "All Categories" },
  { value: "restaurant", label: "Restaurants" }, { value: "dentist", label: "Dentists" },
  { value: "hotel", label: "Hotels" }, { value: "gym", label: "Gyms" },
  { value: "pharmacy", label: "Pharmacies" }, { value: "barbershop", label: "Barbershops" },
];
const LOC_OPTS = [
  { value: "", label: "All Cities" },
  { value: "New York", label: "New York" }, { value: "London", label: "London" },
  { value: "Miami", label: "Miami" }, { value: "Los Angeles", label: "Los Angeles" },
];
const Q_OPTS = [
  { value: "", label: "Any Quality" }, { value: "80", label: "80+ High" },
  { value: "60", label: "60+ Medium" }, { value: "40", label: "40+ Low" },
];

function ResultsPageInner() {
  const sp = useSearchParams();
  const [f, setF] = useState<BusinessFilters>({
    q: "", job_id: sp.get("job_id") || "",
    country: "", city: "", page: 1, per_page: 25,
  });
  const [showFilters, setShowFilters] = useState(false);
  const set = (k: keyof BusinessFilters, v: unknown) =>
    setF(p => ({ ...p, [k]: v, ...(k !== "page" ? { page: 1 } : {}) }));

  const activeCount = [f.q, f.city, f.country, f.job_id, f.has_phone, f.has_email, f.has_website].filter(Boolean).length;
  const { data, loading, error, refresh } = useApi(() => getBusinesses(f), [JSON.stringify(f)]);

  return (
    <div className="animate-up" style={{ padding: "24px 28px" }}>
      <SectionHeader
        title="Results"
        sub={`${(data?.total ?? 0).toLocaleString()} businesses collected`}
        action={<>
          <Btn variant="ghost" size="sm" onClick={refresh} icon={<RefreshCw size={13} />} />
          <Btn variant="secondary" size="sm" icon={<SlidersHorizontal size={12} />}
            onClick={() => setShowFilters(v => !v)}>
            Filters{activeCount > 0 ? ` (${activeCount})` : ""}
          </Btn>
          {(["csv", "xlsx", "json"] as const).map(fmt => (
            <a key={fmt} href={exportUrl(fmt, f)}>
              <Btn variant="secondary" size="sm" icon={<Download size={12} />}>{fmt.toUpperCase()}</Btn>
            </a>
          ))}
        </>}
      />

      {/* Filter bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 300 }}>
          <Search size={12} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-3)", pointerEvents: "none" }} />
          <input className="field" style={{ paddingLeft: 30, height: 32 }}
            placeholder="Search name, phone, email…"
            value={f.q || ""} onChange={e => set("q", e.target.value)} />
        </div>
        <select className="field" style={{ width: 148, height: 32 }} value={f.category || ""} onChange={e => set("category", e.target.value)}>
          {CAT_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="field" style={{ width: 140, height: 32 }} value={f.city || ""} onChange={e => set("city", e.target.value)}>
          {LOC_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="field" style={{ width: 130, height: 32 }} value={String(f.min_quality ?? "")} onChange={e => set("min_quality", e.target.value || undefined)}>
          {Q_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <div style={{ display: "flex", gap: 5 }}>
          {(["has_phone", "has_email", "has_website"] as const).map(k => {
            const on = !!(f as Record<string, unknown>)[k];
            const icons: Record<string, React.ReactNode> = { has_phone: <Phone size={10} />, has_email: <Mail size={10} />, has_website: <Globe size={10} /> };
            return (
              <button key={k} onClick={() => set(k, on ? undefined : true)} style={{
                height: 32, padding: "0 10px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
                background: on ? "rgba(99,102,241,.12)" : "var(--bg-card2)",
                color: on ? "#818cf8" : "var(--text-3)",
                border: `1px solid ${on ? "rgba(99,102,241,.3)" : "var(--border)"}`,
                transition: "all .15s",
              }}>
                {icons[k]}
                {k.replace("has_", "").charAt(0).toUpperCase() + k.replace("has_", "").slice(1)}
              </button>
            );
          })}
          {activeCount > 0 && (
            <button onClick={() => setF({ q: "", job_id: "", country: "", city: "", page: 1, per_page: 25 })}
              style={{ height: 32, width: 32, borderRadius: 6, cursor: "pointer", background: "var(--bg-card2)", border: "1px solid var(--border)", color: "var(--text-3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <X size={12} />
            </button>
          )}
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
          : !data?.items.length
            ? <Empty icon={Building2} title="No businesses found" sub="Adjust your filters or start a new scrape" />
            : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>#</th><th>Business</th><th>Category</th><th>Location</th>
                    <th>Phone</th><th>Website</th><th style={{ textAlign: "center" }}>Rating</th>
                    <th style={{ textAlign: "center" }}>Quality</th><th>Contact</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.items.map((b: Business, i) => (
                    <tr key={b.id}>
                      <td style={{ color: "var(--text-3)", fontVariantNumeric: "tabular-nums", fontSize: 11, width: 40 }}>
                        {((f.page ?? 1) - 1) * (f.per_page ?? 25) + i + 1}
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, background: "linear-gradient(135deg,rgba(99,102,241,.15),rgba(139,92,246,.15))", border: "1px solid rgba(99,102,241,.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <Building2 size={13} color="#818cf8" />
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {b.name || "—"}
                            </div>
                            {b.source_url && (
                              <a href={b.source_url} target="_blank" rel="noreferrer"
                                style={{ fontSize: 10, color: "var(--accent)", textDecoration: "none", display: "flex", alignItems: "center", gap: 3 }}>
                                <ExternalLink size={9} />Maps
                              </a>
                            )}
                          </div>
                        </div>
                      </td>
                      <td><span style={{ fontSize: 11, color: "var(--text-3)" }}>{b.category || "—"}</span></td>
                      <td>
                        <div style={{ maxWidth: 150 }}>
                          <div style={{ fontSize: 12, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {b.city || b.full_address?.split(",")[0] || "—"}
                          </div>
                          {(b.state_region || b.country) && (
                            <div style={{ fontSize: 10, color: "var(--text-3)" }}>
                              {[b.state_region, b.country].filter(Boolean).join(", ")}
                            </div>
                          )}
                        </div>
                      </td>
                      <td>
                        {b.phone
                          ? <a href={`tel:${b.phone}`} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--text-2)", textDecoration: "none" }}>
                            <Phone size={11} color="#4ade80" />{b.phone}
                          </a>
                          : <span style={{ color: "var(--text-3)", fontSize: 11 }}>—</span>}
                      </td>
                      <td>
                        {b.website
                          ? <a href={b.website.startsWith("http") ? b.website : `https://${b.website}`} target="_blank" rel="noreferrer"
                            style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--text-2)", textDecoration: "none", maxWidth: 140, overflow: "hidden" }}>
                            <Globe size={11} color="#60a5fa" />
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {b.website.replace(/^https?:\/\/(www\.)?/, "")}
                            </span>
                          </a>
                          : <span style={{ color: "var(--text-3)", fontSize: 11 }}>—</span>}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        {b.rating != null
                          ? <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                              <Star size={11} color="#fbbf24" fill="#fbbf24" />
                              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{b.rating.toFixed(1)}</span>
                            </div>
                            {b.review_count != null && <span style={{ fontSize: 9, color: "var(--text-3)" }}>({b.review_count.toLocaleString()})</span>}
                          </div>
                          : <span style={{ color: "var(--text-3)", fontSize: 11 }}>—</span>}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                          <span style={{ fontSize: 14, fontWeight: 800, color: Q_COLOR(b.quality_score), fontVariantNumeric: "tabular-nums" }}>
                            {b.quality_score}
                          </span>
                          <Bar value={b.quality_score} color={Q_COLOR(b.quality_score)} h={2} />
                        </div>
                      </td>
                      <td>
                        <Badge type={b.email ? "green" : b.phone ? "blue" : "gray"}>
                          {b.email ? "Email" : b.phone ? "Phone" : "Basic"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
      </div>

      {data && data.pages > 1 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>
            {((f.page ?? 1) - 1) * (f.per_page ?? 25) + 1}–{Math.min((f.page ?? 1) * (f.per_page ?? 25), data.total)} of {data.total.toLocaleString()}
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <Btn variant="secondary" size="xs" disabled={(f.page ?? 1) <= 1} onClick={() => set("page", (f.page ?? 1) - 1)}>← Prev</Btn>
            <Btn variant="secondary" size="xs" disabled={(f.page ?? 1) >= data.pages} onClick={() => set("page", (f.page ?? 1) + 1)}>Next →</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ResultsPage() {
  return (
    <Suspense fallback={<div style={{ padding: 32, color: "var(--text-3)", display: "flex", alignItems: "center", justifyContent: "center", height: "60vh" }}><Spin size={24} /></div>}>
      <ResultsPageInner />
    </Suspense>
  );
}
