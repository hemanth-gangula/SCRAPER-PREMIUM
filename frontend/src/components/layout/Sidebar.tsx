"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LayoutDashboard, Search, Briefcase, Building2, Download, Clock, Settings, Activity, HeartPulse, BarChart3, Sparkles, Zap, Sun, Moon, ChevronsLeft, ChevronsRight, Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "./ThemeProvider";

const GROUPS = [
  {
    label: "Scraping", items: [
      { href: "/", icon: LayoutDashboard, label: "Dashboard" },
      { href: "/scraper", icon: Search, label: "New Scrape" },
      { href: "/jobs", icon: Briefcase, label: "Jobs" },
    ]
  },
  {
    label: "Data", items: [
      { href: "/results", icon: Building2, label: "Results" },
      { href: "/exports", icon: Download, label: "Exports" },
      { href: "/enrichment", icon: Sparkles, label: "AI Enrich" },
      { href: "/agent", icon: Bot, label: "AI Agent" },
    ]
  },
  {
    label: "Automation", items: [
      { href: "/schedules", icon: Clock, label: "Schedules" },
      { href: "/logs", icon: Activity, label: "Live Logs" },
    ]
  },
  {
    label: "System", items: [
      { href: "/usage", icon: BarChart3, label: "Usage" },
      { href: "/settings", icon: Settings, label: "Settings" },
      { href: "/health", icon: HeartPulse, label: "Health" },
    ]
  },
];

export function Sidebar() {
  const path = usePathname();
  const { theme, toggle } = useTheme();
  const [col, setCol] = useState(false);

  return (
    <aside
      className={cn("flex flex-col h-full shrink-0 transition-[width] duration-300", col ? "w-[56px]" : "w-[210px]")}
      style={{ background: "var(--sidebar-bg)", borderRight: "1px solid var(--sidebar-border)" }}
    >
      {/* Logo */}
      <div className={cn("flex items-center gap-3 h-[56px] px-3 shrink-0 border-b", col && "justify-center")}
        style={{ borderColor: "var(--sidebar-border)" }}>
        <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: "linear-gradient(135deg,#2563eb,#7c3aed)" }}>
          <Zap className="w-4 h-4 text-white" strokeWidth={2.5} />
        </div>
        {!col && <div><p className="text-[13px] font-extrabold text-white leading-none">Scraper</p><p className="text-[9px] font-bold tracking-[.2em] uppercase" style={{ color: "var(--sidebar-active)" }}>Premium</p></div>}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
        {GROUPS.map(({ label, items }) => (
          <div key={label}>
            {!col && <p className="px-2 mb-1 text-[9px] font-bold uppercase tracking-[.14em]" style={{ color: "var(--sidebar-heading,#3d4f62)" }}>{label}</p>}
            <ul className="space-y-0.5">
              {items.map(({ href, icon: Icon, label: lbl }) => {
                const active = href === "/" ? path === "/" : path.startsWith(href);
                return (
                  <li key={href}>
                    <Link href={href} title={col ? lbl : undefined}
                      className={cn("flex items-center gap-2.5 rounded-lg transition-all relative group",
                        col ? "justify-center w-9 h-9 mx-auto" : "px-2.5 py-2",
                        active ? "text-white" : "hover:text-white")}
                      style={active ? { background: "var(--sidebar-active)", boxShadow: "0 2px 8px rgba(37,99,235,.4)" } : {}}
                    >
                      {!active && <span className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: "var(--sidebar-hover)" }} />}
                      <Icon className="relative z-10 shrink-0 w-[15px] h-[15px]" strokeWidth={active ? 2.5 : 1.75} style={{ color: active ? "#fff" : "var(--sidebar-text)" }} />
                      {!col && <span className="relative z-10 text-[13px] font-[530]" style={{ color: active ? "#fff" : "var(--sidebar-text)" }}>{lbl}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Bottom */}
      <div className="border-t p-2 space-y-0.5 shrink-0" style={{ borderColor: "var(--sidebar-border)" }}>
        {[
          { fn: toggle, icon: theme === "dark" ? Sun : Moon, label: theme === "dark" ? "Light Mode" : "Dark Mode" },
          { fn: () => setCol(v => !v), icon: col ? ChevronsRight : ChevronsLeft, label: "Collapse" },
        ].map(({ fn, icon: Icon, label: lbl }) => (
          <button key={lbl} onClick={fn} title={col ? lbl : undefined}
            className={cn("w-full flex items-center gap-2.5 rounded-lg transition-all hover:text-white",
              col ? "justify-center w-9 h-9 mx-auto" : "px-2.5 py-2")}
            style={{ color: "var(--sidebar-text)" }}
          >
            <Icon className="w-[15px] h-[15px] shrink-0" strokeWidth={1.75} />
            {!col && <span className="text-[13px] font-[530]">{lbl}</span>}
          </button>
        ))}
        {!col && <p className="px-2.5 pt-1 text-[9px] font-bold tracking-widest uppercase" style={{ color: "var(--sidebar-heading,#3d4f62)" }}>v1.0.0</p>}
      </div>
    </aside>
  );
}
