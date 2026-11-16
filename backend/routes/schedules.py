"""Schedule management endpoints."""

import uuid
from datetime import datetime, timezone
from flask import Blueprint, jsonify, request
from services.storage import load_schedules, save_schedules

bp = Blueprint("schedules", __name__)


@bp.get("/schedules")
def list_all():
    return jsonify(load_schedules())


@bp.post("/schedules")
def create():
    data = request.get_json(force=True, silent=True) or {}
    if not data.get("name"):
        return jsonify({"error": "name is required"}), 400

    from services.scheduler import next_cron_run
    cron = data.get("cron", "0 6 * * *")
    from datetime import datetime, timezone
    nxt  = next_cron_run(cron, datetime.now(timezone.utc))

    schedule = {
        "id":          str(uuid.uuid4()),
        "name":        data["name"],
        "config":      data.get("config", {}),
        "cron":        cron,
        "enabled":     data.get("enabled", True),
        "next_run":    nxt.isoformat() if nxt else None,
        "last_run":    None,
        "run_count":   0,
        "created_at":  datetime.now(timezone.utc).isoformat(),
    }
    schedules = load_schedules()
    schedules.append(schedule)
    save_schedules(schedules)
    return jsonify(schedule), 201


@bp.put("/schedules/<sched_id>")
def update(sched_id):
    data = request.get_json(force=True, silent=True) or {}
    schedules = load_schedules()
    for s in schedules:
        if s["id"] == sched_id:
            s.update({k: v for k, v in data.items() if k not in ("id", "created_at")})
            save_schedules(schedules)
            return jsonify(s)
    return jsonify({"error": "Not found"}), 404


@bp.delete("/schedules/<sched_id>")
def delete(sched_id):
    schedules = load_schedules()
    updated = [s for s in schedules if s["id"] != sched_id]
    if len(updated) == len(schedules):
        return jsonify({"error": "Not found"}), 404
    save_schedules(updated)
    return jsonify({"deleted": sched_id})
