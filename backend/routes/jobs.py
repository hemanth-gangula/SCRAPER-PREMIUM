"""Job management endpoints."""

import math
from flask import Blueprint, jsonify, request
from services.jobs import create_job, pause_job, resume_job, cancel_job
from services.storage import get_job, list_jobs, load_checkpoint, append_activity
from services.worker_client import get_worker_progress

bp = Blueprint("jobs", __name__)


def _validate_create(data: dict) -> list[str]:
    errors = []
    try:
        s = int(data.get("start_index", 1))
        e = int(data.get("end_index", 100))
    except (TypeError, ValueError):
        return ["start_index and end_index must be integers"]
    if s < 1:
        errors.append("start_index must be >= 1")
    if e < s:
        errors.append("end_index must be >= start_index")
    if e - s > 9999:
        errors.append("Index range cannot exceed 10,000")
    try:
        dl = int(data.get("daily_limit", 500))
        jl = int(data.get("job_limit", e))  # default job_limit to end_index
        if dl < 1: errors.append("daily_limit must be >= 1")
        if jl < 1: errors.append("job_limit must be >= 1")
    except (TypeError, ValueError):
        errors.append("daily_limit and job_limit must be integers")
    if not data.get("search_query") and not data.get("category"):
        errors.append("Provide at least search_query or category")
    return errors


@bp.post("/jobs")
def create():
    data = request.get_json(force=True, silent=True) or {}
    errors = _validate_create(data)
    if errors:
        return jsonify({"error": "Validation failed", "details": errors}), 400
    job = create_job(data)
    return jsonify(job), 201


@bp.get("/jobs")
def list_all():
    page = int(request.args.get("page", 1))
    per_page = int(request.args.get("per_page", 20))
    status = request.args.get("status")
    jobs, total = list_jobs(page=page, page_size=per_page, status=status)
    return jsonify({
        "items":    jobs,
        "total":    total,
        "page":     page,
        "per_page": per_page,
        "pages":    math.ceil(total / per_page) if total else 0,
    })


@bp.get("/jobs/<job_id>")
def get(job_id):
    job = get_job(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    # Merge live worker progress if available
    live = get_worker_progress(job_id)
    if live:
        job.update({k: v for k, v in live.items() if k not in ("id",)})
    checkpoint = load_checkpoint(job_id)
    job["checkpoint"] = checkpoint
    return jsonify(job)


@bp.post("/jobs/<job_id>/pause")
def pause(job_id):
    job = pause_job(job_id)
    if not job:
        return jsonify({"error": "Cannot pause this job"}), 422
    return jsonify(job)


@bp.post("/jobs/<job_id>/resume")
def resume(job_id):
    job = resume_job(job_id)
    if not job:
        return jsonify({"error": "Cannot resume this job"}), 422
    return jsonify(job)


@bp.post("/jobs/<job_id>/cancel")
def cancel(job_id):
    job = cancel_job(job_id)
    if not job:
        return jsonify({"error": "Cannot cancel this job"}), 422
    return jsonify(job)


@bp.get("/jobs/<job_id>/progress")
def progress(job_id):
    job = get_job(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    live = get_worker_progress(job_id)
    if live:
        return jsonify(live)
    return jsonify({
        "job_id":         job_id,
        "status":         job.get("status"),
        "records_saved":  job.get("records_saved", 0),
        "dupes_skipped":  job.get("dupes_skipped", 0),
        "progress_pct":   job.get("progress_pct", 0),
        "current_index":  job.get("current_index", 0),
    })
