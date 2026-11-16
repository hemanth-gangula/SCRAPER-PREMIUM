"""
Job lifecycle management.
All job state is persisted to storage/jobs/<id>.json immediately.
"""

import uuid
import threading
from datetime import datetime, timezone
from typing import Optional

from .storage import save_job, get_job, update_job, list_jobs, append_activity

_dispatch_callback = None  # set by the Flask app after worker is connected


def set_dispatch_callback(fn):
    global _dispatch_callback
    _dispatch_callback = fn


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_job(params: dict) -> dict:
    job_id = str(uuid.uuid4())
    end_index   = int(params.get("end_index", 100))
    start_index = max(1, int(params.get("start_index", 1)))
    # job_limit: default to end_index; never exceed end_index
    job_limit   = int(params.get("job_limit", end_index))
    job_limit   = min(job_limit, end_index)  # server-side enforcement
    daily_limit = int(params.get("daily_limit", 500))

    job = {
        "id":             job_id,
        "status":         "queued",
        "config":         params,
        "search_query":   params.get("search_query", ""),
        "category":       params.get("category", ""),
        "country":        params.get("country", ""),
        "state_region":   params.get("state_region", ""),
        "city":           params.get("city", ""),
        "postal_code":    params.get("postal_code", ""),
        "source":         params.get("source", "google_maps"),
        "start_index":    start_index,
        "end_index":      end_index,
        "daily_limit":    daily_limit,
        "job_limit":      job_limit,
        "records_saved":  0,
        "dupes_skipped":  0,
        "failed_records": 0,
        "retries":        0,
        "progress_pct":   0,
        "current_index":  0,
        "current_business": None,
        "last_error":     None,
        "last_checkpoint_at": None,
        "worker_pid":     None,
        "created_at":     _now(),
        "started_at":     None,
        "finished_at":    None,
        "updated_at":     _now(),
    }
    save_job(job)
    append_activity(job_id, "job_created",
        f"Job created: {job['search_query'] or job['category']} in "
        f"{job['city'] or job['country']} — limit: {job_limit} unique records")
    # Dispatch to worker
    if _dispatch_callback:
        threading.Thread(target=_dispatch_callback, args=(job_id,), daemon=True).start()
    return job


def pause_job(job_id: str) -> Optional[dict]:
    job = get_job(job_id)
    if not job or job["status"] not in ("queued", "running"):
        return None
    updated = update_job(job_id, {"status": "paused"})
    if updated:
        append_activity(job_id, "job_paused", "Job paused by user")
    return updated


def resume_job(job_id: str) -> Optional[dict]:
    job = get_job(job_id)
    if not job or job["status"] not in ("paused", "interrupted"):
        return None
    updated = update_job(job_id, {"status": "queued"})
    if updated and _dispatch_callback:
        threading.Thread(target=_dispatch_callback, args=(job_id,), daemon=True).start()
    if updated:
        append_activity(job_id, "job_resumed", "Job resumed by user")
    return updated


def cancel_job(job_id: str) -> Optional[dict]:
    job = get_job(job_id)
    if not job or job["status"] in ("completed", "cancelled"):
        return None
    updated = update_job(job_id, {"status": "cancelled", "finished_at": _now()})
    if updated:
        append_activity(job_id, "job_cancelled", "Job cancelled by user")
    return updated


def recover_interrupted_jobs() -> list[str]:
    """On startup, move any 'running' jobs back to 'queued' for recovery."""
    recovered = []
    jobs, _ = list_jobs(page=1, page_size=1000)
    for job in jobs:
        if job.get("status") == "running":
            update_job(job["id"], {"status": "interrupted"})
            recovered.append(job["id"])
            append_activity(job["id"], "job_interrupted", "Worker restarted — job flagged for recovery")
    return recovered
