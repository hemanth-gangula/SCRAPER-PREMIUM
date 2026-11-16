"""Dashboard summary — all values from real storage."""

from flask import Blueprint, jsonify
from services.storage import count_businesses, list_jobs
from services.quota import get_today
from services.dedup import index_stats
from services.worker_client import get_worker_health
from config import config

bp = Blueprint("dashboard", __name__)


@bp.get("/dashboard")
def dashboard():
    total_businesses = count_businesses()

    recent_jobs, total_jobs = list_jobs(page=1, page_size=10)
    status_counts: dict[str, int] = {}
    total_saved = 0
    total_dupes = 0
    for j in recent_jobs:
        s = j.get("status", "unknown")
        status_counts[s] = status_counts.get(s, 0) + 1
        total_saved += j.get("records_saved", 0)
        total_dupes += j.get("dupes_skipped", 0)

    # Get full status counts
    all_jobs, _ = list_jobs(page=1, page_size=1000)
    all_status: dict[str, int] = {}
    for j in all_jobs:
        s = j.get("status", "unknown")
        all_status[s] = all_status.get(s, 0) + 1

    quota = get_today(config.DEFAULT_DAILY_LIMIT)
    worker = get_worker_health()
    dedup = index_stats()

    return jsonify({
        "total_businesses":   total_businesses,
        "total_jobs":         total_jobs,
        "job_status_counts":  all_status,
        "total_saved":        total_saved,
        "total_dupes_skipped": total_dupes,
        "today_quota":        quota,
        "worker_status":      worker.get("status", "unknown"),
        "worker_queue_length": worker.get("queue_length", 0),
        "dedup_fingerprints": dedup.get("total_fingerprints", 0),
        "recent_jobs":        recent_jobs[:5],
    })
