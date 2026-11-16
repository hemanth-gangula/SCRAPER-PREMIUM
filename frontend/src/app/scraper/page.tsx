"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createJob, type CreateJobInput } from "@/lib/api";
import {
  Search, MapPin, Settings2, Zap, ChevronDown, Info,
  Hash, BarChart3,
} from "lucide-react";

// ─── Data ────────────────────────────────────────────────────────────────────

const CATS = [
  { value: "", label: "Custom query only" },
  { value: "restaurant", label: "Restaurants" },
  { value: "dentist", label: "Dentists" },
  { value: "doctor", label: "Doctors / Clinics" },
  { value: "lawyer", label: "Lawyers" },
  { value: "accountant", label: "Accountants" },
  { value: "real estate agent", label: "Real Estate" },
  { value: "hotel", label: "Hotels" },
  { value: "gym", label: "Gyms & Fitness" },
  { value: "pharmacy", label: "Pharmacies" },
  { value: "coffee shop", label: "Coffee Shops" },
  { value: "hair salon", label: "Hair Salons" },
  { value: "barbershop", label: "Barbershops" },
  { value: "bakery", label: "Bakeries" },
  { value: "florist", label: "Florists" },
  { value: "car dealer", label: "Car Dealers" },
  { value: "contractor", label: "Contractors" },
  { value: "electrician", label: "Electricians" },
  { value: "plumber", label: "Plumbers" },
];

const COUNTRIES = [
  { value: "", label: "Any country" },
  { value: "United States", label: "United States" },
  { value: "United Kingdom", label: "United Kingdom" },
  { value: "Canada", label: "Canada" },
  { value: "Australia", label: "Australia" },
  { value: "Germany", label: "Germany" },
  { value: "France", label: "France" },
  { value: "Spain", label: "Spain" },
  { value: "Brazil", label: "Brazil" },
  { value: "India", label: "India" },
  { value: "Mexico", label: "Mexico" },
  { value: "Italy", label: "Italy" },
];

const LIMIT_PRESETS = [5, 10, 20, 50, 100, 200];

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title, subtitle }: {
  icon: React.ElementType; title: string; subtitle?: string;
}) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.2)" }}>
        <Icon size={15} color="#3b82f6" strokeWidth={1.75} />
      </div>
      <div>
        <p className="text-sm font-bold leading-tight" style={{ color: "var(--text)" }}>{title}</p>
        {subtitle && <p className="text-[11px] mt-0.5" style={{ color: "var(--text-3)" }}>{subtitle}</p>}
      </div>
    </div>
  );
}

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: "var(--text-2)" }}>
        {children}
      </span>
      {hint && (
        <span title={hint} className="cursor-help">
          <Info size={10} style={{ color: "var(--text-3)" }} />
        </span>
      )}
    </div>
  );
}

function Input({ ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      style={{
        width: "100%",
        background: "var(--bg-input)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        padding: ".5rem .75rem",
        fontSize: 12,
        color: "var(--text)",
        outline: "none",
        transition: "border .15s, box-shadow .15s",
      }}
      onFocus={e => {
        e.target.style.borderColor = "var(--accent)";
        e.target.style.boxShadow = "0 0 0 2px rgba(59,130,246,.2)";
      }}
      onBlur={e => {
        e.target.style.borderColor = "var(--border)";
        e.target.style.boxShadow = "none";
      }}
    />
  );
}

function Select({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        {...props}
        style={{
          width: "100%",
          appearance: "none",
          background: "var(--bg-input)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          padding: ".5rem 2.2rem .5rem .75rem",
          fontSize: 12,
          color: "var(--text)",
          outline: "none",
          cursor: "pointer",
        }}
      >
        {children}
      </select>
      <ChevronDown size={12} style={{ color: "var(--text-3)", position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: "var(--border2)", margin: "4px 0 20px" }} />;
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ScraperPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<CreateJobInput>({
    search_query: "", category: "", country: "United States",
    state_region: "", city: "", postal_code: "",
    start_index: 1, end_index: 20, daily_limit: 500, job_limit: 20,
  });
  const [showAdvanced, setShowAdvanced] = useState(false);

  const set = (k: keyof CreateJobInput, v: string | number) =>
    setForm(p => ({ ...p, [k]: v }));

  // Keep job_limit in sync with end_index
  const setLimit = (n: number) => setForm(p => ({ ...p, end_index: n, job_limit: n }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.search_query && !form.category) {
      setError("Enter a search query or pick a category.");
      return;
    }
    setLoading(true);
    try {
      const j = await createJob(form);
      router.push(`/jobs/${j.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const locationSummary = [form.city, form.state_region, form.country]
    .filter(Boolean)
    .join(", ") || "No location set";

  return (
    <div style={{ padding: "24px 28px", maxWidth: 740, animation: "up .3s ease-out" }}>

      {/* Page header */}
      <div className="mb-7">
        <h1 className="text-lg font-bold tracking-tight mb-1" style={{ color: "var(--text)" }}>
          New Scrape
        </h1>
        <p className="text-xs" style={{ color: "var(--text-3)" }}>
          Configure a Google Maps scraping job and launch it in one click.
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4">

        {/* ── Card 1: What to search ──────────────────────────────────── */}
        <div className="card" style={{ padding: "22px 24px" }}>
          <SectionHeader icon={Search} title="What to scrape"
            subtitle="Enter a free-text query, pick a category, or both" />

          <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
            {/* Search query — full width */}
            <div style={{ gridColumn: "1 / -1" }}>
              <Label hint="What to search on Google Maps — e.g. 'Italian restaurants Manhattan'">
                Search Query
              </Label>
              <div className="relative">
                <Search size={13} style={{
                  position: "absolute", left: 10, top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--text-3)", pointerEvents: "none",
                }} />
                <input
                  value={form.search_query || ""}
                  onChange={e => set("search_query", e.target.value)}
                  placeholder="e.g. Italian restaurants, roofing contractors, coworking spaces…"
                  style={{
                    width: "100%",
                    background: "var(--bg-input)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    padding: ".5rem .75rem .5rem 2rem",
                    fontSize: 12,
                    color: "var(--text)",
                    outline: "none",
                    transition: "border .15s, box-shadow .15s",
                  }}
                  onFocus={e => {
                    e.target.style.borderColor = "var(--accent)";
                    e.target.style.boxShadow = "0 0 0 2px rgba(59,130,246,.2)";
                  }}
                  onBlur={e => {
                    e.target.style.borderColor = "var(--border)";
                    e.target.style.boxShadow = "none";
                  }}
                />
              </div>
            </div>

            {/* Category */}
            <div>
              <Label>Category</Label>
              <Select value={form.category || ""} onChange={e => set("category", e.target.value)}>
                {CATS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </div>
          </div>
        </div>

        {/* ── Card 2: Location ────────────────────────────────────────── */}
        <div className="card" style={{ padding: "22px 24px" }}>
          <SectionHeader icon={MapPin} title="Location"
            subtitle="Narrow results to a specific area" />

          <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <Label>Country</Label>
              <Select value={form.country || ""} onChange={e => set("country", e.target.value)}>
                {COUNTRIES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </div>
            <div>
              <Label>State / Region</Label>
              <Input placeholder="e.g. California"
                value={form.state_region || ""}
                onChange={e => set("state_region", e.target.value)} />
            </div>
            <div>
              <Label>City</Label>
              <Input placeholder="e.g. New York"
                value={form.city || ""}
                onChange={e => set("city", e.target.value)} />
            </div>
            <div>
              <Label hint="Postal or ZIP code — narrows results significantly">
                ZIP / Postal Code
              </Label>
              <Input placeholder="e.g. 10001"
                value={form.postal_code || ""}
                onChange={e => set("postal_code", e.target.value)} />
            </div>
          </div>
        </div>

        {/* ── Card 3: Result limit ─────────────────────────────────────── */}
        <div className="card" style={{ padding: "22px 24px" }}>
          <SectionHeader icon={BarChart3} title="How many results?"
            subtitle="Maximum unique businesses to collect" />

          {/* Preset buttons */}
          <div className="flex gap-2 flex-wrap mb-5">
            {LIMIT_PRESETS.map(n => (
              <button
                key={n}
                type="button"
                onClick={() => setLimit(n)}
                className="px-4 py-2 rounded-lg text-xs font-semibold transition-all"
                style={form.job_limit === n ? {
                  background: "linear-gradient(135deg,#2563eb,#7c3aed)",
                  color: "#fff",
                  border: "1px solid transparent",
                  boxShadow: "0 2px 8px rgba(37,99,235,.4)",
                } : {
                  background: "var(--bg-input)",
                  color: "var(--text-2)",
                  border: "1px solid var(--border)",
                }}
              >
                {n}
              </button>
            ))}
            {/* Custom input */}
            <input
              type="number"
              min={1}
              max={500}
              value={LIMIT_PRESETS.includes(form.job_limit as number) ? "" : form.job_limit}
              onChange={e => { const n = parseInt(e.target.value); if (n > 0) setLimit(n); }}
              placeholder="Custom…"
              className="px-3 py-2 rounded-lg text-xs"
              style={{
                width: 90,
                background: "var(--bg-input)",
                border: "1px solid var(--border)",
                color: "var(--text)",
                outline: "none",
              }}
              onFocus={e => { e.target.style.borderColor = "var(--accent)"; }}
              onBlur={e => { e.target.style.borderColor = "var(--border)"; }}
            />
          </div>

          {/* Limit explanation */}
          <div className="flex items-center justify-between px-4 py-3 rounded-xl"
            style={{ background: "var(--bg-card2)", border: "1px solid var(--border2)" }}>
            <div className="flex items-center gap-2">
              <Hash size={12} style={{ color: "var(--text-3)" }} />
              <span className="text-xs" style={{ color: "var(--text-2)" }}>
                Will save up to
              </span>
              <span className="text-sm font-bold" style={{ color: "var(--accent)" }}>
                {form.job_limit}
              </span>
              <span className="text-xs" style={{ color: "var(--text-2)" }}>
                unique businesses
              </span>
            </div>
            <span className="text-[10px] px-2 py-1 rounded-md"
              style={{ background: "rgba(16,185,129,0.1)", color: "#10b981" }}>
              Dedup active
            </span>
          </div>
        </div>

        {/* ── Advanced settings (collapsed by default) ──────────────── */}
        <div className="card" style={{ overflow: "hidden" }}>
          <button
            type="button"
            onClick={() => setShowAdvanced(v => !v)}
            className="w-full flex items-center justify-between px-6 py-4 transition-colors"
            style={{ background: "transparent" }}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-hover)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
            <div className="flex items-center gap-3">
              <Settings2 size={14} style={{ color: "var(--text-3)" }} />
              <span className="text-xs font-semibold" style={{ color: "var(--text-2)" }}>
                Advanced settings
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full"
                style={{
                  background: "var(--bg-card2)", color: "var(--text-3)",
                  border: "1px solid var(--border2)"
                }}>
                optional
              </span>
            </div>
            <ChevronDown
              size={13}
              style={{
                color: "var(--text-3)",
                transform: showAdvanced ? "rotate(180deg)" : "none",
                transition: "transform .2s",
              }}
            />
          </button>

          {showAdvanced && (
            <div style={{ padding: "0 24px 22px", borderTop: "1px solid var(--border2)" }}>
              <div className="pt-5 grid gap-4" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
                <div>
                  <Label hint="First result index to collect (minimum 1)">Start Index</Label>
                  <Input
                    type="number" min={1}
                    value={form.start_index}
                    onChange={e => set("start_index", parseInt(e.target.value) || 1)}
                  />
                </div>
                <div>
                  <Label hint="Last result index — matches Result Limit by default">End Index</Label>
                  <Input
                    type="number" min={1}
                    value={form.end_index}
                    onChange={e => {
                      const n = parseInt(e.target.value) || 1;
                      setForm(p => ({ ...p, end_index: n, job_limit: Math.min(p.job_limit as number, n) }));
                    }}
                  />
                </div>
                <div>
                  <Label hint="Max scrapes per calendar day across all jobs">Daily Quota</Label>
                  <Input
                    type="number" min={1}
                    value={form.daily_limit}
                    onChange={e => set("daily_limit", parseInt(e.target.value) || 500)}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Review summary ──────────────────────────────────────────── */}
        <div className="rounded-xl px-5 py-4"
          style={{ background: "var(--bg-card2)", border: "1px solid var(--border2)" }}>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-3"
            style={{ color: "var(--text-3)" }}>
            Review
          </p>
          <div className="grid gap-y-2.5" style={{ gridTemplateColumns: "auto 1fr", columnGap: 24 }}>
            {[
              ["Query", form.search_query || "—"],
              ["Category", CATS.find(c => c.value === form.category)?.label || "Custom query"],
              ["Location", locationSummary],
              ["Limit", `${form.job_limit} unique businesses`],
            ].map(([k, v]) => (
              <div key={k} className="contents">
                <span className="text-[11px]" style={{ color: "var(--text-3)" }}>{k}</span>
                <span className="text-[11px] font-semibold" style={{ color: "var(--text)" }}>{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Error ───────────────────────────────────────────────────── */}
        {error && (
          <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl text-xs"
            style={{
              background: "rgba(244,63,94,.1)", border: "1px solid rgba(244,63,94,.25)",
              color: "#f43f5e"
            }}>
            <span className="font-semibold">Error:</span> {error}
          </div>
        )}

        {/* ── Launch button ────────────────────────────────────────────── */}
        <div className="flex items-center justify-between pt-1">
          <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
            Duplicates are skipped automatically. You can pause or cancel at any time.
          </p>
          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-sm text-white
                       transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: loading ? "var(--bg-card2)" : "linear-gradient(135deg,#2563eb,#7c3aed)",
              boxShadow: loading ? "none" : "0 4px 16px rgba(37,99,235,.4)",
              minWidth: 160,
              justifyContent: "center",
            }}
          >
            {loading ? (
              <>
                <span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                Starting…
              </>
            ) : (
              <>
                <Zap size={14} />
                Launch Scrape
              </>
            )}
          </button>
        </div>

      </form>

      {/* ── Keyboard shortcut hint ───────────────────────────────────── */}
      <p className="text-center text-[10px] mt-4" style={{ color: "var(--text-3)" }}>
        Press <kbd className="px-1.5 py-0.5 rounded text-[9px] font-mono"
          style={{
            background: "var(--bg-card2)", border: "1px solid var(--border)",
            color: "var(--text-3)"
          }}>Enter</kbd> to submit
      </p>

    </div>
  );
}
