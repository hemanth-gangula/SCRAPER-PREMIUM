"use client";
import { useState } from "react";
import { exportUrl, type BusinessFilters } from "@/lib/api";
import { SectionHeader } from "@/components/ui";
import { Download, FileText, Table2, Braces, Filter, ArrowDownToLine, Check } from "lucide-react";

const FMTS = [
  {
    id: "xlsx" as const,
    label: "Excel",
    ext: ".xlsx",
    icon: Table2,
    color: "#22c55e",
    bg: "rgba(34,197,94,.08)",
    border: "rgba(34,197,94,.18)",
    desc: "Multi-sheet workbook, best for analysis",
    badge: "Most Popular",
  },
  {
    id: "csv" as const,
    label: "CSV",
    ext: ".csv",
    icon: FileText,
    color: "#60a5fa",
    bg: "rgba(96,165,250,.08)",
    border: "rgba(96,165,250,.18)",
    desc: "UTF-8 BOM, Excel & Google Sheets friendly",
    badge: null,
  },
  {
    id: "json" as const,
    label: "JSON",
    ext: ".json",
    icon: Braces,
    color: "#a78bfa",
    bg: "rgba(167,139,250,.08)",
    border: "rgba(167,139,250,.18)",
    desc: "Raw JSON array, ideal for developers",
    badge: null,
  },
];

const FILTER_FIELDS = [
  { k: "q", label: "Search", placeholder: "Name, phone, email…" },
  { k: "city", label: "City", placeholder: "e.g. New York" },
  { k: "country", label: "Country", placeholder: "e.g. United States" },
  { k: "job_id", label: "Job ID", placeholder: "Filter by job UUID" },
];

export default function ExportsPage() {
  const [f, setF] = useState<BusinessFilters>({ q: "", city: "", country: "", job_id: "" });
  const [hover, setHover] = useState<string | null>(null);
  const [clicked, setClicked] = useState<string | null>(null);

  const hasFilters = Object.values(f).some(Boolean);

  function handleClick(id: string) {
    setClicked(id);
    setTimeout(() => setClicked(null), 1800);
  }

  return (
    <div className="animate-up" style={{ padding: "24px 28px", maxWidth: 740 }}>
      <SectionHeader
        title="Export Data"
        sub="Download your scraped businesses in your preferred format"
      />

      {/* Filters card */}
      <div className="card" style={{ padding: "20px 24px", marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: "rgba(99,102,241,.1)", border: "1px solid rgba(99,102,241,.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Filter size={13} color="var(--accent)" />
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Filters</span>
          <span style={{ fontSize: 11, color: "var(--text-3)", marginLeft: "auto" }}>applied to all formats</span>
          {hasFilters && (
            <button onClick={() => setF({ q: "", city: "", country: "", job_id: "" })}
              style={{ fontSize: 11, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 600 }}>
              Clear
            </button>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {FILTER_FIELDS.map(({ k, label, placeholder }) => (
            <div key={k}>
              <label className="label" style={{ display: "block", marginBottom: 6 }}>{label}</label>
              <input
                className="field"
                placeholder={placeholder}
                value={(f as Record<string, unknown>)[k] as string || ""}
                onChange={e => setF(p => ({ ...p, [k]: e.target.value }))}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Format cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
        {FMTS.map(({ id, label, ext, icon: Icon, color, bg, border, desc, badge }) => {
          const isHovered = hover === id;
          const isClicked = clicked === id;
          return (
            <a
              key={id}
              href={exportUrl(id, f)}
              download
              onClick={() => handleClick(id)}
              style={{ textDecoration: "none" }}
            >
              <div
                onMouseEnter={() => setHover(id)}
                onMouseLeave={() => setHover(null)}
                style={{
                  background: "var(--bg-card)",
                  border: `1px solid ${isHovered ? border : "var(--border)"}`,
                  borderRadius: 12, padding: "22px 20px",
                  cursor: "pointer",
                  transition: "all .18s cubic-bezier(.4,0,.2,1)",
                  transform: isHovered ? "translateY(-3px)" : "none",
                  boxShadow: isHovered ? `0 8px 24px ${bg}, 0 0 0 1px ${border}` : "none",
                  position: "relative", overflow: "hidden",
                }}
              >
                {badge && (
                  <div style={{ position: "absolute", top: 12, right: 12, fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 99, background: "rgba(34,197,94,.15)", color: "#4ade80", border: "1px solid rgba(34,197,94,.2)", letterSpacing: ".05em" }}>
                    {badge}
                  </div>
                )}
                <div style={{ width: 44, height: 44, borderRadius: 11, background: bg, border: `1px solid ${border}`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                  <Icon size={20} color={color} />
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", marginBottom: 6, letterSpacing: "-.03em" }}>
                  {label}
                  <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text-3)", marginLeft: 6 }}>{ext}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.5, marginBottom: 20 }}>{desc}</div>
                <div style={{
                  display: "flex", alignItems: "center", gap: 7,
                  fontSize: 12, fontWeight: 700,
                  color: isClicked ? "#4ade80" : color,
                  transition: "color .2s",
                }}>
                  {isClicked ? <Check size={14} /> : <ArrowDownToLine size={14} />}
                  {isClicked ? "Downloaded!" : `Download ${label}`}
                </div>
              </div>
            </a>
          );
        })}
      </div>

      <p style={{ fontSize: 11, color: "var(--text-3)", textAlign: "center", marginTop: 20 }}>
        Large datasets may take a moment to generate. All exports include every field.
      </p>
    </div>
  );
}
