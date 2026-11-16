"""
Agent tool registry.

Each tool wraps one or more existing backend API endpoints via internal
function calls (not HTTP — the agent runs in the same Flask process).
The LLM receives OpenAI-style function schemas; we execute them here.

SECURITY: The LLM can only call these registered tools.
         It cannot execute shell commands or arbitrary Python.
"""

from __future__ import annotations

import json
import time
from typing import Any

# ---------------------------------------------------------------------------
# Tool schemas (OpenAI function-calling format)
# ---------------------------------------------------------------------------

TOOL_SCHEMAS: list[dict] = [

    # ── Search / query ──────────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "search_businesses",
            "description": (
                "Search the already-scraped business database. "
                "Use this BEFORE creating a new scraping job to check if the data already exists."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query":       {"type": "string",  "description": "Free-text search (name, category, etc.)"},
                    "city":        {"type": "string",  "description": "City filter"},
                    "state_region":{"type": "string",  "description": "State or region filter"},
                    "country":     {"type": "string",  "description": "Country filter"},
                    "category":    {"type": "string",  "description": "Business category filter"},
                    "has_email":   {"type": "boolean", "description": "Filter to records that have an email"},
                    "has_phone":   {"type": "boolean", "description": "Filter to records that have a phone number"},
                    "has_website": {"type": "boolean", "description": "Filter to records that have a website"},
                    "min_quality": {"type": "integer", "description": "Minimum quality score 0–100"},
                    "per_page":    {"type": "integer", "description": "Max results to return (default 20, max 100)"},
                },
                "required": [],
            },
        },
    },

    # ── Create a new scraping job ────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "create_scraping_job",
            "description": (
                "Create a new Google Maps scraping job. "
                "Call this only after the user has explicitly confirmed the parameters. "
                "IMPORTANT: Always pass the exact end_index and job_limit the user requested. "
                "Do NOT use defaults of 100 — use the number the user specified. "
                "Returns the job_id."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "search_query": {
                        "type": "string",
                        "description": "Google Maps search query, e.g. 'restaurants in Manhattan'",
                    },
                    "category":     {"type": "string", "description": "Business category, e.g. 'Restaurant'"},
                    "country":      {"type": "string", "description": "Country name"},
                    "state_region": {"type": "string", "description": "State or region"},
                    "city":         {"type": "string", "description": "City"},
                    "postal_code":  {"type": "string", "description": "Postal/ZIP code"},
                    "start_index":  {"type": "integer", "description": "Start index (default 1, minimum 1)"},
                    "end_index":    {
                        "type": "integer",
                        "description": (
                            "Maximum number of results to scrape. "
                            "MUST equal the count the user asked for (e.g. if user said '5 businesses', pass 5). "
                            "Never default to 100 when the user specified a smaller number."
                        ),
                    },
                    "daily_limit":  {"type": "integer", "description": "Daily quota limit (default 500)"},
                    "job_limit":    {
                        "type": "integer",
                        "description": (
                            "Hard cap on unique records to save. "
                            "MUST equal end_index — set to the same value the user requested. "
                            "Never default to 100 when the user specified a smaller number."
                        ),
                    },
                },
                "required": ["search_query", "end_index", "job_limit"],
            },
        },
    },

    # ── Get job status ───────────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "get_job_status",
            "description": "Get the current status and progress of a scraping job.",
            "parameters": {
                "type": "object",
                "properties": {
                    "job_id": {"type": "string", "description": "The job ID to check"},
                },
                "required": ["job_id"],
            },
        },
    },

    # ── List jobs ────────────────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "list_jobs",
            "description": "List recent scraping jobs with their status.",
            "parameters": {
                "type": "object",
                "properties": {
                    "status":   {"type": "string", "description": "Filter by status: pending|running|completed|failed|cancelled"},
                    "per_page": {"type": "integer", "description": "Number of jobs to return (default 10)"},
                },
                "required": [],
            },
        },
    },

    # ── Pause job ────────────────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "pause_job",
            "description": "Pause a currently running scraping job (can be resumed later).",
            "parameters": {
                "type": "object",
                "properties": {
                    "job_id": {"type": "string", "description": "The job ID to pause"},
                },
                "required": ["job_id"],
            },
        },
    },

    # ── Resume job ───────────────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "resume_job",
            "description": "Resume a paused scraping job.",
            "parameters": {
                "type": "object",
                "properties": {
                    "job_id": {"type": "string", "description": "The job ID to resume"},
                },
                "required": ["job_id"],
            },
        },
    },

    # ── Cancel job ───────────────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "cancel_job",
            "description": "Cancel a scraping job. This cannot be undone.",
            "parameters": {
                "type": "object",
                "properties": {
                    "job_id": {"type": "string", "description": "The job ID to cancel"},
                },
                "required": ["job_id"],
            },
        },
    },

    # ── Wait for job completion ──────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "wait_for_job",
            "description": (
                "Poll a job until it completes (or times out). "
                "Returns the final status. Use after creating a job if the user wants to wait for results."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "job_id":          {"type": "string",  "description": "Job ID to monitor"},
                    "timeout_seconds": {"type": "integer", "description": "Max seconds to wait (default 300)"},
                    "poll_interval":   {"type": "integer", "description": "Seconds between polls (default 10)"},
                },
                "required": ["job_id"],
            },
        },
    },

    # ── Export data ──────────────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "export_data",
            "description": (
                "Export scraped businesses to XLSX, CSV, or JSON. "
                "Returns a download URL that the user can click."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "format":  {
                        "type": "string",
                        "enum": ["xlsx", "csv", "json"],
                        "description": "Export file format",
                    },
                    "job_id":   {"type": "string",  "description": "Filter export to a specific job"},
                    "query":    {"type": "string",  "description": "Free-text filter"},
                    "city":     {"type": "string",  "description": "Filter by city"},
                    "country":  {"type": "string",  "description": "Filter by country"},
                    "category": {"type": "string",  "description": "Filter by category"},
                },
                "required": ["format"],
            },
        },
    },

    # ── Dashboard summary ────────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "get_dashboard",
            "description": "Get a summary of the scraper system: total businesses, jobs, dedup stats, quota usage.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },

    # ── Health check ─────────────────────────────────────────────────────────
    {
        "type": "function",
        "function": {
            "name": "get_health",
            "description": "Check the health of the scraper system (API server, worker, storage).",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
]

# ---------------------------------------------------------------------------
# Tool executor
# ---------------------------------------------------------------------------

class ToolExecutor:
    """
    Executes agent tool calls by calling existing backend service functions.
    All calls are internal (no HTTP round-trip).
    """

    BACKEND_BASE = "http://localhost:5000"

    def execute(self, tool_name: str, arguments: dict) -> str:
        """
        Dispatch to the correct handler. Returns a JSON string
        (always a string so it can be stuffed into a tool message).
        """
        handler = getattr(self, f"_tool_{tool_name}", None)
        if handler is None:
            return json.dumps({"error": f"Unknown tool: {tool_name}"})
        try:
            result = handler(**arguments)
            return json.dumps(result, default=str)
        except TypeError as exc:
            return json.dumps({"error": f"Invalid arguments for {tool_name}: {exc}"})
        except Exception as exc:
            return json.dumps({"error": str(exc)})

    # ── Internal helpers ─────────────────────────────────────────────────────

    def _api_get(self, path: str, params: dict | None = None) -> Any:
        import requests
        resp = requests.get(
            f"{self.BACKEND_BASE}{path}",
            params=params,
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()

    def _api_post(self, path: str, body: dict | None = None) -> Any:
        import requests
        resp = requests.post(
            f"{self.BACKEND_BASE}{path}",
            json=body or {},
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()

    # ── Tool handlers ────────────────────────────────────────────────────────

    def _tool_search_businesses(
        self,
        query: str = "",
        city: str = "",
        state_region: str = "",
        country: str = "",
        category: str = "",
        has_email: bool | None = None,
        has_phone: bool | None = None,
        has_website: bool | None = None,
        min_quality: int | None = None,
        per_page: int = 20,
    ) -> dict:
        params: dict[str, Any] = {}
        if query:        params["q"] = query
        if city:         params["city"] = city
        if state_region: params["state_region"] = state_region
        if country:      params["country"] = country
        if category:     params["category"] = category
        if has_email is not None:   params["has_email"] = str(has_email).lower()
        if has_phone is not None:   params["has_phone"] = str(has_phone).lower()
        if has_website is not None: params["has_website"] = str(has_website).lower()
        if min_quality is not None: params["min_quality"] = min_quality
        params["per_page"] = min(per_page, 100)

        data = self._api_get("/api/businesses", params)
        businesses = data.get("businesses", [])

        # Slim down each record so it fits in the LLM context
        slim = []
        for b in businesses:
            slim.append({
                "id":       b.get("id"),
                "name":     b.get("name"),
                "category": b.get("category"),
                "city":     b.get("city"),
                "country":  b.get("country"),
                "phone":    b.get("phone"),
                "email":    b.get("email"),
                "website":  b.get("website"),
                "rating":   b.get("rating"),
                "quality_score": b.get("quality_score"),
            })

        return {
            "total":      data.get("total", len(slim)),
            "returned":   len(slim),
            "businesses": slim,
        }

    def _tool_create_scraping_job(
        self,
        search_query: str,
        category: str = "",
        country: str = "",
        state_region: str = "",
        city: str = "",
        postal_code: str = "",
        start_index: int = 1,       # API requires >= 1
        end_index: int = 20,        # conservative default; LLM must pass user's value
        daily_limit: int = 500,
        job_limit: int | None = None,  # defaults to end_index if not given
    ) -> dict:
        # Clamp start_index to valid range
        start_index = max(1, start_index)
        # job_limit must not exceed end_index — they should be equal
        # If the LLM forgot to pass job_limit, derive it from end_index
        if job_limit is None:
            job_limit = end_index
        # Always use the smaller of the two — prevents the LLM from sending
        # mismatched values (e.g. end_index=5 but job_limit=100)
        effective_limit = min(end_index, job_limit)
        body = {
            "search_query": search_query,
            "category":     category,
            "country":      country,
            "state_region": state_region,
            "city":         city,
            "postal_code":  postal_code,
            "start_index":  start_index,
            "end_index":    effective_limit,  # use the min
            "daily_limit":  daily_limit,
            "job_limit":    effective_limit,  # keep both in sync
            "source":       "google_maps",
        }
        result = self._api_post("/api/jobs", body)
        return {
            "job_id":  result.get("job_id") or result.get("id"),
            "status":  result.get("status"),
            "message": result.get("message", "Job created successfully"),
        }

    def _tool_get_job_status(self, job_id: str) -> dict:
        data = self._api_get(f"/api/jobs/{job_id}")
        return {
            "job_id":    data.get("id") or data.get("job_id"),
            "status":    data.get("status"),
            "progress":  data.get("progress", {}),
            "results":   data.get("results_count", data.get("results", 0)),
            "created_at": data.get("created_at"),
            "started_at": data.get("started_at"),
            "ended_at":   data.get("ended_at"),
            "query":      data.get("search_query") or data.get("query"),
        }

    def _tool_list_jobs(self, status: str = "", per_page: int = 10) -> dict:
        params: dict[str, Any] = {"per_page": per_page}
        if status:
            params["status"] = status
        data = self._api_get("/api/jobs", params)
        jobs = data.get("jobs", [])
        slim = []
        for j in jobs:
            slim.append({
                "job_id":  j.get("id") or j.get("job_id"),
                "status":  j.get("status"),
                "query":   j.get("search_query") or j.get("query"),
                "results": j.get("results_count", 0),
                "created_at": j.get("created_at"),
            })
        return {"total": data.get("total", len(slim)), "jobs": slim}

    def _tool_pause_job(self, job_id: str) -> dict:
        result = self._api_post(f"/api/jobs/{job_id}/pause")
        return {"job_id": job_id, "status": result.get("status"), "message": result.get("message", "Paused")}

    def _tool_resume_job(self, job_id: str) -> dict:
        result = self._api_post(f"/api/jobs/{job_id}/resume")
        return {"job_id": job_id, "status": result.get("status"), "message": result.get("message", "Resumed")}

    def _tool_cancel_job(self, job_id: str) -> dict:
        result = self._api_post(f"/api/jobs/{job_id}/cancel")
        return {"job_id": job_id, "status": result.get("status"), "message": result.get("message", "Cancelled")}

    def _tool_wait_for_job(
        self,
        job_id: str,
        timeout_seconds: int = 300,
        poll_interval: int = 10,
    ) -> dict:
        deadline = time.time() + timeout_seconds
        last_status = "unknown"
        polls = 0

        while time.time() < deadline:
            try:
                data = self._api_get(f"/api/jobs/{job_id}")
                last_status = data.get("status", "unknown")
                polls += 1

                if last_status in ("completed", "failed", "cancelled"):
                    return {
                        "job_id":   job_id,
                        "status":   last_status,
                        "results":  data.get("results_count", data.get("results", 0)),
                        "polls":    polls,
                        "message":  f"Job {last_status} after {polls} polls",
                    }

                time.sleep(poll_interval)
            except Exception as exc:
                return {"job_id": job_id, "status": "error", "error": str(exc), "polls": polls}

        return {
            "job_id":  job_id,
            "status":  last_status,
            "polls":   polls,
            "message": f"Timed out after {timeout_seconds}s. Last status: {last_status}",
        }

    def _tool_export_data(
        self,
        format: str = "xlsx",
        job_id: str = "",
        query: str = "",
        city: str = "",
        country: str = "",
        category: str = "",
    ) -> dict:
        params: dict[str, Any] = {}
        if job_id:   params["job_id"] = job_id
        if query:    params["q"] = query
        if city:     params["city"] = city
        if country:  params["country"] = country
        if category: params["category"] = category

        fmt = format.lower()
        if fmt not in ("xlsx", "csv", "json"):
            return {"error": f"Invalid format '{format}'. Use xlsx, csv, or json."}

        # Build the download URL the user can click
        from urllib.parse import urlencode
        qs = urlencode(params) if params else ""
        download_url = f"/api/exports/{fmt}{'?' + qs if qs else ''}"
        full_url = f"http://localhost:5000{download_url}"

        # Verify the endpoint is reachable and returns data
        import requests as _r
        resp = _r.get(full_url, timeout=30)
        if resp.status_code != 200:
            return {"error": f"Export failed with status {resp.status_code}"}

        content_length = len(resp.content)
        return {
            "format":       fmt,
            "download_url": download_url,
            "full_url":     full_url,
            "file_size_bytes": content_length,
            "message": (
                f"Export ready: {content_length:,} bytes. "
                f"Download at: {full_url}"
            ),
        }

    def _tool_get_dashboard(self) -> dict:
        data = self._api_get("/api/dashboard")
        # Return a compact summary
        return {
            "total_businesses": data.get("total_businesses", 0),
            "total_jobs":       data.get("total_jobs", 0),
            "running_jobs":     data.get("running_jobs", 0),
            "completed_jobs":   data.get("completed_jobs", 0),
            "dedup_total":      data.get("dedup_total", 0),
            "quality_average":  data.get("quality_average", 0),
            "daily_quota_used": data.get("daily_quota_used", 0),
        }

    def _tool_get_health(self) -> dict:
        data = self._api_get("/api/health")
        return {
            "status":  data.get("status"),
            "worker":  data.get("worker"),
            "storage": data.get("storage"),
            "uptime":  data.get("uptime"),
        }


# Singleton executor — shared across all agent sessions
executor = ToolExecutor()
