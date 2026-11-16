"""Health check endpoints."""

import os
from flask import Blueprint, jsonify
from services.storage import count_businesses
from services.worker_client import get_worker_health
from services.dedup import index_stats

bp = Blueprint("health", __name__)


@bp.get("/health")
def health():
    # DB/storage check
    storage_ok = False
    storage_error = None
    try:
        _ = count_businesses()
        storage_ok = True
    except Exception as e:
        storage_error = str(e)

    # Worker check
    worker = get_worker_health()

    # Dedup index
    dedup = index_stats()

    status = "ok" if storage_ok and worker.get("status") == "ok" else "degraded"

    return jsonify({
        "status":         status,
        "version":        "1.0.0",
        "storage":        "ok" if storage_ok else f"error: {storage_error}",
        "storage_dir":    os.environ.get("SCRAPER_STORAGE_DIR", "unknown"),
        "worker":         worker,
        "dedup_index":    dedup,
        "chromium_path":  os.environ.get("CHROMIUM_EXECUTABLE_PATH", "not set"),
    }), 200
