import { clsx, type ClassValue } from "clsx";
export const cn = (...a: ClassValue[]) => clsx(a);

export function fmtDate(iso?: string|null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric",hour:"2-digit",minute:"2-digit"});
}

export function fmtAgo(iso?: string|null) {
  if (!iso) return "—";
  const s = Math.floor((Date.now()-new Date(iso).getTime())/1000);
  if (s<60)  return `${s}s ago`;
  if (s<3600) return `${Math.floor(s/60)}m ago`;
  if (s<86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

export function statusBadge(s: string) {
  const m: Record<string,string> = {
    running:     "bg-blue-500/15 text-blue-400 border-blue-500/25",
    completed:   "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
    queued:      "bg-amber-500/15 text-amber-400 border-amber-500/25",
    paused:      "bg-orange-500/15 text-orange-400 border-orange-500/25",
    failed:      "bg-rose-500/15 text-rose-400 border-rose-500/25",
    cancelled:   "bg-[var(--bg-muted)] text-[var(--text-subtle)] border-transparent",
    interrupted: "bg-purple-500/15 text-purple-400 border-purple-500/25",
  };
  return m[s] ?? "bg-[var(--bg-muted)] text-[var(--text-muted)] border-transparent";
}

export function qualityColor(n: number) {
  if (n>=80) return "text-emerald-400";
  if (n>=50) return "text-amber-400";
  return "text-rose-400";
}
