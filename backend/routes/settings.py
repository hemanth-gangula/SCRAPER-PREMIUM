"""Settings CRUD."""

from flask import Blueprint, jsonify, request
from services.storage import load_settings, save_settings

bp = Blueprint("settings", __name__)

ALLOWED_KEYS = {
    "default_daily_limit", "default_job_limit", "default_start_index",
    "default_end_index", "headless", "request_delay_ms",
    "page_load_timeout_ms", "max_concurrent_jobs",
    "chromium_executable_path",
}


@bp.get("/settings")
def get():
    return jsonify(load_settings())


@bp.put("/settings")
def update():
    data = request.get_json(force=True, silent=True) or {}
    settings = load_settings()
    updated = {}
    errors = {}
    for k, v in data.items():
        if k not in ALLOWED_KEYS:
            errors[k] = "Unknown setting"
            continue
        settings[k] = v
        updated[k] = v
    save_settings(settings)
    return jsonify({"updated": updated, "errors": errors})
