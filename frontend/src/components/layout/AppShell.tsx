"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard, Search, Briefcase, Building2, Download,
  Clock, Activity, Settings, Heart, BarChart3, Sparkles,
  Zap, Sun, Moon, Bell, ChevronDown, User, Bot,
  PanelLeftClose, PanelLeftOpen, MapPin,
} from "lucide-react";
import { useTheme } from "./ThemeProvider";

const NAV = [
  {
    group: "Scraping",
    items: [
      { href: "/", icon: LayoutDashboard, label: "Dashboard" },
      { href: "/scraper", icon: MapPin, label: "New Scrape" },
      { href: "/jobs", icon: Briefcase, label: "Jobs" },
    ],
  },
  {
    group: "Data",
    items: [
      { href: "/results", icon: Building2, label: "Results" },
      { href: "/exports", icon: Download, label: "Exports" },
      { href: "/enrichment", icon: Sparkles, label: "AI Enrich" },
      { href: "/agent", icon: Bot, label: "AI Agent" },
    ],
  },
  {
    group: "Automation",
    items: [
      { href: "/schedules", icon: Clock, label: "Schedules" },
      { href: "/logs", icon: Activity, label: "Live Logs" },
    ],
  },
  {
    group: "System",
    items: [
      { href: "/usage", icon: BarChart3, label: "Usage" },
      { href: "/settings", icon: Settings, label: "Settings" },
      { href: "/health", icon: Heart, label: "Health" },
    ],
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { theme, toggle } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const W = collapsed ? 60 : 228;

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--bg)" }}>

      {/* ══ SIDEBAR — always dark navy ═══════════════════════════════ */}
      <aside style={{
        width: W, minWidth: W,
        display: "flex", flexDirection: "column",
        background: "var(--sidebar-bg)",
        borderRight: "1px solid var(--sidebar-border)",
        height: "100vh", flexShrink: 0,
        transition: "width .2s ease, min-width .2s ease",
        overflow: "hidden",
      }}>

        {/* Logo */}
        <div style={{
          height: 60, display: "flex", alignItems: "center",
          padding: collapsed ? "0" : "0 18px",
          justifyContent: collapsed ? "center" : "flex-start",
          gap: 12, flexShrink: 0,
          borderBottom: "1px solid var(--sidebar-border)",
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 9, flexShrink: 0,
            background: "linear-gradient(135deg,#2563eb,#7c3aed)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 2px 12px rgba(37,99,235,.5)",
          }}>
            <Zap size={15} color="#fff" strokeWidth={2.5} />
          </div>
          {!collapsed && (
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#f8fafc", lineHeight: 1, letterSpacing: "-.03em" }}>
                Scraper
              </div>
              <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".15em", textTransform: "uppercase", color: "#3b82f6", lineHeight: 1, marginTop: 2 }}>
                Premium
              </div>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: "12px 8px", overflowY: "auto", overflowX: "hidden" }}>
          {NAV.map(({ group, items }) => (
            <div key={group} style={{ marginBottom: 8 }}>
              {!collapsed && (
                <div style={{
                  fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                  letterSpacing: ".1em", color: "#334155",
                  padding: "10px 10px 5px",
                }}>
                  {group}
                </div>
              )}
              {collapsed && <div style={{ height: 8 }} />}

              {items.map(({ href, icon: Icon, label }) => {
                const active = href === "/" ? path === "/" : path.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    title={collapsed ? label : undefined}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: collapsed ? 0 : 10,
                      padding: collapsed ? "10px 0" : "8px 10px",
                      justifyContent: collapsed ? "center" : "flex-start",
                      borderRadius: 7, marginBottom: 2,
                      textDecoration: "none",
                      position: "relative",
                      background: active ? "rgba(37,99,235,.18)" : "transparent",
                      color: active ? "#93c5fd" : "var(--sidebar-text)",
                      fontWeight: active ? 600 : 400,
                      fontSize: 13,
                      transition: "background .12s, color .12s",
                    }}
                    onMouseEnter={e => {
                      if (!active) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,.06)";
                    }}
                    onMouseLeave={e => {
                      if (!active) (e.currentTarget as HTMLElement).style.background = "transparent";
                    }}
                  >
                    {/* Active left bar */}
                    {active && (
                      <span style={{
                        position: "absolute", left: 0, top: "15%", bottom: "15%",
                        width: 3, borderRadius: 99,
                        background: "#3b82f6",
                        boxShadow: "0 0 10px rgba(59,130,246,.8)",
                      }} />
                    )}
                    <Icon
                      size={15} strokeWidth={active ? 2.2 : 1.75}
                      style={{ flexShrink: 0, color: active ? "#93c5fd" : "#64748b" }}
                    />
                    {!collapsed && <span style={{ flex: 1, whiteSpace: "nowrap" }}>{label}</span>}
                    {!collapsed && active && (
                      <span style={{
                        width: 6, height: 6, borderRadius: "50%",
                        background: "#3b82f6", flexShrink: 0,
                        boxShadow: "0 0 6px rgba(59,130,246,.9)",
                      }} />
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Bottom */}
        <div style={{ borderTop: "1px solid var(--sidebar-border)", padding: "10px 8px 12px", flexShrink: 0 }}>
          <SideBtn icon={theme === "light" ? <Moon size={15} strokeWidth={1.75} /> : <Sun size={15} strokeWidth={1.75} />}
            label={theme === "light" ? "Dark Mode" : "Light Mode"} collapsed={collapsed} onClick={toggle} />
          <SideBtn
            icon={collapsed ? <PanelLeftOpen size={15} strokeWidth={1.75} /> : <PanelLeftClose size={15} strokeWidth={1.75} />}
            label={collapsed ? "Expand" : "Collapse"} collapsed={collapsed} onClick={() => setCollapsed(v => !v)} />
          {!collapsed && (
            <div style={{
              display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
              borderRadius: 8, marginTop: 6, background: "rgba(255,255,255,.05)",
              border: "1px solid rgba(255,255,255,.08)",
            }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg,#2563eb,#7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <User size={13} color="#fff" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#f8fafc", lineHeight: 1.3 }}>Admin</div>
                <div style={{ fontSize: 10, color: "#475569" }}>Free Plan</div>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* ══ MAIN (white/light) ════════════════════════════════════════ */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>

        {/* Topbar */}
        <header style={{
          height: 60, minHeight: 60, display: "flex", alignItems: "center",
          gap: 12, padding: "0 24px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-card)", flexShrink: 0,
          boxShadow: "0 1px 0 var(--border)",
        }}>
          <div style={{ flex: 1 }}>
            {/* Search bar */}
            <div style={{ position: "relative", maxWidth: 340 }}>
              <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-3)", pointerEvents: "none" }} />
              <input
                className="field"
                placeholder="Search…"
                style={{ paddingLeft: 32, height: 34, fontSize: 13 }}
              />
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <TopBtn onClick={toggle} title="Toggle theme">
              {theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
            </TopBtn>
            <TopBtn title="Notifications" style={{ position: "relative" }}>
              <Bell size={15} />
              <span style={{ position: "absolute", top: 7, right: 7, width: 6, height: 6, borderRadius: "50%", background: "#dc2626", border: "2px solid var(--bg-card)" }} />
            </TopBtn>
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "5px 12px", borderRadius: 8,
              border: "1.5px solid var(--border)", background: "var(--bg-card2)",
              cursor: "pointer", transition: "border-color .15s, background .15s",
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--border-focus)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; }}
            >
              <div style={{ width: 26, height: 26, borderRadius: "50%", background: "linear-gradient(135deg,#2563eb,#7c3aed)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <User size={12} color="#fff" />
              </div>
              <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>Admin</span>
              <ChevronDown size={12} color="var(--text-3)" />
            </div>
          </div>
        </header>

        {/* Page content */}
        <main style={{ flex: 1, overflowY: "auto", overflowX: "hidden", background: "var(--bg)" }}>
          {children}
        </main>
      </div>
    </div>
  );
}

function SideBtn({ icon, label, collapsed, onClick }: { icon: React.ReactNode; label: string; collapsed: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} title={collapsed ? label : undefined} style={{
      display: "flex", alignItems: "center",
      gap: collapsed ? 0 : 10,
      justifyContent: collapsed ? "center" : "flex-start",
      width: "100%", padding: collapsed ? "10px 0" : "8px 10px",
      borderRadius: 7, border: "none", background: "transparent",
      cursor: "pointer", color: "#64748b", fontSize: 13,
      transition: "background .12s, color .12s", marginBottom: 2,
    }}
      onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,.06)"; e.currentTarget.style.color = "#94a3b8"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#64748b"; }}
    >
      <span style={{ flexShrink: 0 }}>{icon}</span>
      {!collapsed && <span>{label}</span>}
    </button>
  );
}

function TopBtn({ children, onClick, title, style }: { children: React.ReactNode; onClick?: () => void; title?: string; style?: React.CSSProperties }) {
  return (
    <button onClick={onClick} title={title} style={{
      width: 36, height: 36, borderRadius: 8, flexShrink: 0,
      border: "1.5px solid var(--border)", background: "var(--bg-card2)",
      display: "flex", alignItems: "center", justifyContent: "center",
      cursor: "pointer", color: "var(--text-3)",
      transition: "all .15s", position: "relative",
      ...style,
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--border-focus)"; e.currentTarget.style.color = "var(--accent)"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-3)"; }}
    >
      {children}
    </button>
  );
}
