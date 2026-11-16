"use client";
import type { LucideIcon } from "lucide-react";

/* ══════════════════════════════════════════════════════════
   BUTTON
══════════════════════════════════════════════════════════ */
type BV = "primary" | "secondary" | "ghost" | "danger" | "success";
type BS = "xs" | "sm" | "md" | "lg";

const BV_MAP: Record<BV, React.CSSProperties> = {
  primary: { background: "linear-gradient(135deg,#2563eb,#4f46e5)", color: "#fff", border: "1px solid transparent", boxShadow: "0 1px 6px rgba(37,99,235,.4), 0 0 0 1px rgba(37,99,235,.2)" },
  secondary: { background: "var(--bg-card)", color: "var(--text-2)", border: "1.5px solid var(--border)", boxShadow: "0 1px 2px rgba(0,0,0,.04)" },
  ghost: { background: "transparent", color: "var(--text-2)", border: "1.5px solid transparent" },
  danger: { background: "var(--red-light)", color: "var(--red)", border: "1px solid rgba(220,38,38,.25)" },
  success: { background: "var(--green-light)", color: "var(--green)", border: "1px solid rgba(22,163,74,.25)" },
};
const BS_MAP: Record<BS, React.CSSProperties> = {
  xs: { height: 26, padding: "0 9px", fontSize: 11, borderRadius: 6, gap: 4 },
  sm: { height: 32, padding: "0 12px", fontSize: 12, borderRadius: 7, gap: 5 },
  md: { height: 36, padding: "0 16px", fontSize: 13, borderRadius: 8, gap: 6 },
  lg: { height: 42, padding: "0 20px", fontSize: 14, borderRadius: 9, gap: 7 },
};

interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BV; size?: BS; loading?: boolean;
  icon?: React.ReactNode; iconRight?: React.ReactNode;
}

export function Btn({ variant = "primary", size = "sm", loading, icon, iconRight, style, children, disabled, ...rest }: BtnProps) {
  const { gap, ...sizeStyle } = BS_MAP[size] as Record<string, unknown>;
  return (
    <button disabled={disabled || loading} {...rest} style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      gap: gap as number, fontWeight: 600, fontFamily: "inherit",
      cursor: disabled || loading ? "not-allowed" : "pointer",
      transition: "all .15s", outline: "none", whiteSpace: "nowrap",
      opacity: disabled || loading ? .5 : 1,
      ...BV_MAP[variant], ...sizeStyle as React.CSSProperties, ...style,
    }}>
      {loading
        ? <span style={{ width: 12, height: 12, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%", animation: "spin .6s linear infinite", flexShrink: 0 }} />
        : icon}
      {children}
      {!loading && iconRight}
    </button>
  );
}

/* ══════════════════════════════════════════════════════════
   BADGE
══════════════════════════════════════════════════════════ */
type BadgeType = "blue" | "green" | "amber" | "red" | "purple" | "gray" | "orange";

export function Badge({ children, type = "blue", dot, pulse }: {
  children: React.ReactNode; type?: BadgeType; dot?: boolean; pulse?: boolean;
}) {
  const cls: Record<BadgeType, string> = {
    blue: "pill-blue", green: "pill-green", amber: "pill-amber",
    red: "pill-red", purple: "pill-purple", gray: "pill-gray", orange: "pill-orange",
  };
  return (
    <span className={`pill ${cls[type]}`}>
      {dot && <span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor", flexShrink: 0, animation: pulse ? "pulse .9s ease-in-out infinite" : undefined }} />}
      {children}
    </span>
  );
}

/* ══════════════════════════════════════════════════════════
   STAT CARD
══════════════════════════════════════════════════════════ */
type AccentColor = "blue" | "green" | "amber" | "red" | "purple";

const ACCENT: Record<AccentColor, { color: string; bg: string; iconBg: string; border: string }> = {
  blue: { color: "#2563eb", bg: "rgba(37,99,235,.06)", iconBg: "rgba(37,99,235,.1)", border: "#2563eb" },
  green: { color: "#16a34a", bg: "rgba(22,163,74,.06)", iconBg: "rgba(22,163,74,.1)", border: "#16a34a" },
  amber: { color: "#d97706", bg: "rgba(217,119,6,.06)", iconBg: "rgba(217,119,6,.1)", border: "#d97706" },
  red: { color: "#dc2626", bg: "rgba(220,38,38,.06)", iconBg: "rgba(220,38,38,.1)", border: "#dc2626" },
  purple: { color: "#7c3aed", bg: "rgba(124,58,237,.06)", iconBg: "rgba(124,58,237,.1)", border: "#7c3aed" },
};

// Dark mode accent overrides
const ACCENT_DARK: Record<AccentColor, { color: string; iconBg: string }> = {
  blue: { color: "#60a5fa", iconBg: "rgba(59,130,246,.15)" },
  green: { color: "#4ade80", iconBg: "rgba(34,197,94,.15)" },
  amber: { color: "#fbbf24", iconBg: "rgba(245,158,11,.15)" },
  red: { color: "#f87171", iconBg: "rgba(239,68,68,.15)" },
  purple: { color: "#c084fc", iconBg: "rgba(168,85,247,.15)" },
};
void ACCENT_DARK; // used via CSS vars in dark mode

export function StatCard({ label, value, sub, icon: Icon, accent = "blue", trend }: {
  label: string; value: string | number; sub?: string;
  icon?: LucideIcon; accent?: AccentColor;
  trend?: { value: number; label?: string };
}) {
  const a = ACCENT[accent];
  return (
    <div className="card" style={{ padding: "18px 20px", borderTop: `2px solid ${a.border}` }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="label" style={{ marginBottom: 8 }}>{label}</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", letterSpacing: "-.04em", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
            {value}
          </div>
          {(sub || trend) && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
              {sub && <span style={{ fontSize: 11, color: "var(--text-3)" }}>{sub}</span>}
              {trend != null && (
                <span style={{ fontSize: 11, fontWeight: 700, color: trend.value >= 0 ? "var(--green)" : "var(--red)" }}>
                  {trend.value >= 0 ? "↑" : "↓"} {Math.abs(trend.value)}%
                </span>
              )}
            </div>
          )}
        </div>
        {Icon && (
          <div style={{ width: 42, height: 42, borderRadius: 10, flexShrink: 0, background: a.iconBg, border: `1px solid ${a.color}20`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon size={19} color={a.color} strokeWidth={1.75} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   PROGRESS BAR
══════════════════════════════════════════════════════════ */
export function Bar({ value, color = "var(--accent)", h = 4, animated }: {
  value: number; color?: string; h?: number; animated?: boolean;
}) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div style={{ width: "100%", height: h, borderRadius: 99, background: "var(--border)", overflow: "hidden" }}>
      <div style={{
        width: `${pct}%`, height: "100%", borderRadius: 99,
        background: color, transition: "width .5s ease",
        ...(animated && pct < 100 ? { animation: "shimmer 1.6s ease infinite" } : {}),
      }} />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   SPARKLINE
══════════════════════════════════════════════════════════ */
export function Sparkline({ data, color = "var(--accent)", h = 36 }: {
  data: number[]; color?: string; h?: number;
}) {
  if (data.length < 2) return null;
  const w = 120;
  const mn = Math.min(...data), mx = Math.max(...data);
  const range = mx - mn || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - 2 - ((v - mn) / range) * (h - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const first = pts.split(" ")[0].split(",");
  const last = pts.split(" ").pop()!.split(",");
  const area = `M0,${h} L${first[0]},${first[1]} L${pts.split(" ").slice(1).join(" L")} L${last[0]},${h} Z`;
  const id = `spk${Math.random().toString(36).slice(2, 8)}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity=".25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill={color} />
    </svg>
  );
}

/* ══════════════════════════════════════════════════════════
   SPINNER
══════════════════════════════════════════════════════════ */
export function Spin({ size = 18 }: { size?: number }) {
  return (
    <span style={{
      display: "inline-block", width: size, height: size, flexShrink: 0,
      border: `${size > 20 ? 2.5 : 2}px solid var(--border)`,
      borderTopColor: "var(--accent)", borderRadius: "50%",
      animation: "spin .65s linear infinite",
    }} />
  );
}

/* ══════════════════════════════════════════════════════════
   EMPTY STATE
══════════════════════════════════════════════════════════ */
export function Empty({ icon: Icon, title, sub, action }: {
  icon: LucideIcon; title: string; sub?: string; action?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "56px 32px", gap: 12, textAlign: "center" }}>
      <div style={{ width: 52, height: 52, borderRadius: 14, background: "var(--bg-card2)", border: "1.5px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon size={23} color="var(--text-3)" strokeWidth={1.5} />
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-2)", marginBottom: 5 }}>{title}</div>
        {sub && <div style={{ fontSize: 12, color: "var(--text-3)", maxWidth: 280, lineHeight: 1.6 }}>{sub}</div>}
      </div>
      {action}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   SECTION HEADER
══════════════════════════════════════════════════════════ */
export function SectionHeader({ title, sub, action }: {
  title: string; sub?: string; action?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: "var(--text)", margin: 0, letterSpacing: "-.04em" }}>
          {title}
        </h1>
        {sub && <p style={{ fontSize: 13, color: "var(--text-3)", margin: "4px 0 0" }}>{sub}</p>}
      </div>
      {action && <div style={{ display: "flex", gap: 8, alignItems: "center" }}>{action}</div>}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   DIVIDER
══════════════════════════════════════════════════════════ */
export function Divider({ margin = 20 }: { margin?: number }) {
  return <div style={{ height: 1, background: "var(--border)", margin: `${margin}px 0` }} />;
}
