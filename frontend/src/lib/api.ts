const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5000";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Coverage stats (real phone/email/website counts) ─────────────────────────
export interface CoverageStats {
  with_phone: number;
  with_email: number;
  with_website: number;
  total: number;
}

export async function getBusinessCoverage(): Promise<CoverageStats> {
  const [phone, email, website, all] = await Promise.all([
    req<{ total: number }>("/businesses?has_phone=true&per_page=1"),
    req<{ total: number }>("/businesses?has_email=true&per_page=1"),
    req<{ total: number }>("/businesses?has_website=true&per_page=1"),
    req<{ total: number }>("/businesses?per_page=1"),
  ]);
  return {
    with_phone: phone.total,
    with_email: email.total,
    with_website: website.total,
    total: all.total,
  };
}

// ── Types ─────────────────────────────────────────────────────────────────────
export type JobStatus = "queued" | "running" | "paused" | "interrupted" | "completed" | "failed" | "cancelled";

export interface Job {
  id: string; status: JobStatus; search_query: string; category: string;
  country: string; state_region: string; city: string; postal_code: string;
  source: string; start_index: number; end_index: number;
  daily_limit: number; job_limit: number;
  records_saved: number; dupes_skipped: number; failed_records: number;
  progress_pct: number; current_index: number;
  current_business: string | null; last_error: string | null;
  created_at: string; started_at: string | null; finished_at: string | null; updated_at: string;
}

export interface Business {
  id: string; name: string; category: string; phone: string; email: string;
  email_guess: string; website: string; street_address: string; city: string;
  state_region: string; postal_code: string; country: string; full_address: string;
  place_id: string; source_url: string; source: string;
  lat: number | null; lng: number | null; rating: number | null; review_count: number | null;
  price_level: string; quality_score: number; job_id: string;
  first_seen_at: string; last_scraped_at: string;
}

export interface Schedule {
  id: string; name: string; config: Partial<CreateJobInput>; cron: string;
  enabled: boolean; next_run: string | null; last_run: string | null;
  run_count: number; created_at: string;
}

export interface ActivityLog {
  id: string; job_id: string; event_type: string; message: string;
  timestamp: string; ts?: string;
}

export interface DashboardData {
  total_businesses: number; total_jobs: number;
  job_status_counts: Record<string, number>;
  total_saved: number; total_dupes_skipped: number;
  today_quota: { used: number; limit: number; remaining: number; exhausted: boolean };
  worker_status: string; worker_queue_length: number;
  dedup_fingerprints: number; recent_jobs: Job[];
}

export interface HealthData {
  status: string; version: string; chromium_path: string;
  storage: string; dedup_index: { total_fingerprints: number; by_tier: Record<string, number> };
  worker: { status: string; queue_length: number; running: number; pid: number; uptime_s: number };
}

export interface Backup { name: string; path: string; size_bytes: number; created_at?: string }

export interface CreateJobInput {
  search_query?: string; category?: string; country?: string;
  state_region?: string; city?: string; postal_code?: string;
  source?: string; start_index?: number; end_index?: number;
  daily_limit?: number; job_limit?: number;
}

export interface BusinessFilters {
  q?: string; country?: string; city?: string; state_region?: string;
  category?: string; source?: string; job_id?: string;
  has_phone?: boolean; has_email?: boolean; has_website?: boolean;
  min_quality?: number; page?: number; per_page?: number;
}

export interface Paginated<T> { items: T[]; total: number; page: number; per_page: number; pages: number }

// Alias used by enrichment page
export type BusinessesResponse = Paginated<Business>;
// Alias used by dashboard and logs pages
export type JobsResponse = Paginated<Job>;

// ── Auth ─────────────────────────────────────────────────────────────────────
export const login = (password: string) => req<{ ok: boolean }>("/auth/login", { method: "POST", body: JSON.stringify({ password }) });
export const logout = () => req<{ ok: boolean }>("/auth/logout", { method: "POST" });
export const getMe = () => req<{ authenticated: boolean; user: string }>("/auth/me");

// ── Dashboard ─────────────────────────────────────────────────────────────────
export const getDashboard = () => req<DashboardData>("/dashboard");

// ── Jobs ─────────────────────────────────────────────────────────────────────
export const getJobs = (page = 1, status?: string) =>
  req<Paginated<Job>>(`/jobs?page=${page}${status ? `&status=${status}` : ""}`);
export const getJob = (id: string) => req<Job>(`/jobs/${id}`);
export const createJob = (data: CreateJobInput) => req<Job>("/jobs", { method: "POST", body: JSON.stringify(data) });
export const pauseJob = (id: string) => req<Job>(`/jobs/${id}/pause`, { method: "POST" });
export const resumeJob = (id: string) => req<Job>(`/jobs/${id}/resume`, { method: "POST" });
export const cancelJob = (id: string) => req<Job>(`/jobs/${id}/cancel`, { method: "POST" });

// ── Businesses ────────────────────────────────────────────────────────────────
export function getBusinesses(f: BusinessFilters = {}) {
  const p = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => { if (v != null && v !== "") p.set(k, String(v)); });
  return req<Paginated<Business>>(`/businesses?${p}`);
}
export const getBusiness = (id: string) => req<Business>(`/businesses/${id}`);

// ── Exports ───────────────────────────────────────────────────────────────────
export function exportUrl(fmt: "csv" | "xlsx" | "json", f: BusinessFilters = {}) {
  const p = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => { if (v != null && v !== "") p.set(k, String(v)); });
  return `${BASE}/api/exports/${fmt}?${p}`;
}

// ── Schedules ─────────────────────────────────────────────────────────────────
export const getSchedules = () => req<Schedule[]>("/schedules");
export const createSchedule = (d: Partial<Schedule>) => req<Schedule>("/schedules", { method: "POST", body: JSON.stringify(d) });
export const updateSchedule = (id: string, d: Partial<Schedule>) => req<Schedule>(`/schedules/${id}`, { method: "PUT", body: JSON.stringify(d) });
export const deleteSchedule = (id: string) => req<{ deleted: string }>(`/schedules/${id}`, { method: "DELETE" });

// ── Logs ─────────────────────────────────────────────────────────────────────
export const getLogs = (jobId: string, limit = 200) => req<ActivityLog[]>(`/logs/${jobId}?limit=${limit}`);

// ── Backups ───────────────────────────────────────────────────────────────────
export const getBackups = () => req<Backup[]>("/backups");
export const createBackup = (label?: string) => req<{ name: string; status: string }>("/backups", { method: "POST", body: JSON.stringify({ label }) });
export const restoreBackup = (name: string) => req<{ restored: string }>(`/backups/${name}/restore`, { method: "POST" });

// ── Settings ──────────────────────────────────────────────────────────────────
export const getSettings = () => req<Record<string, unknown>>("/settings");
export const updateSettings = (d: Record<string, unknown>) => req<{ updated: Record<string, unknown>; errors: Record<string, unknown> }>("/settings", { method: "PUT", body: JSON.stringify(d) });

// ── Health ────────────────────────────────────────────────────────────────────
export const getHealth = () => req<HealthData>("/health");

// ── Enrichment ────────────────────────────────────────────────────────────────
export const enrichBusiness = (id: string) => req<{ status: string; business: Business }>(`/businesses/${id}/enrich`, { method: "POST" });
