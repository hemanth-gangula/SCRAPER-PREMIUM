"""Backup and restore endpoints."""

from flask import Blueprint, jsonify, request
from services.storage import create_backup, list_backups, restore_backup

bp = Blueprint("backups", __name__)


@bp.get("/backups")
def list_all():
    return jsonify(list_backups())


@bp.post("/backups")
def create():
    label = (request.get_json(force=True, silent=True) or {}).get("label", "")
    name = create_backup(label)
    return jsonify({"name": name, "status": "created"}), 201


@bp.post("/backups/<name>/restore")
def restore(name):
    ok = restore_backup(name)
    if not ok:
        return jsonify({"error": "Backup not found"}), 404
    return jsonify({"restored": name})
