"""Activity log endpoints — static fetch + live SSE stream."""

import json
import os
import time
from pathlib import Path
from flask import Blueprint, jsonify, request, Response
from services.storage import read_activity, _dir as storage_dir

bp = Blueprint("logs", __name__)


@bp.get("/logs/<job_id>")
def get_logs(job_id):
    limit = int(request.args.get("limit", 200))
    return jsonify(read_activity(job_id, limit=limit))


@bp.get("/logs/<job_id>/stream")
def stream_logs(job_id):
    """
    SSE endpoint that tails storage/logs/<job_id>.jsonl in real time.
    Emits each new line as a JSON data event.
    Keeps streaming until the job reaches a terminal state or the client disconnects.
    """
    from services.storage import get_job

    def generate():
        log_file = Path(storage_dir("logs")) / f"{job_id}.jsonl"
        offset = 0

        # First: replay all existing lines so the client gets full history
        if log_file.exists():
            with open(log_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        try:
                            event = json.loads(line)
                            yield f"data: {json.dumps(event)}\n\n"
                        except json.JSONDecodeError:
                            pass
                offset = log_file.stat().st_size

        heartbeat_counter = 0

        while True:
            # Check job status — stop when terminal
            job = get_job(job_id)
            is_terminal = (not job) or (job.get("status") in ("completed", "failed", "cancelled"))

            # Read any new bytes appended since last read
            if log_file.exists():
                current_size = log_file.stat().st_size
                if current_size > offset:
                    with open(log_file, "r", encoding="utf-8") as f:
                        f.seek(offset)
                        new_data = f.read()
                    offset = current_size
                    for line in new_data.splitlines():
                        line = line.strip()
                        if line:
                            try:
                                event = json.loads(line)
                                yield f"data: {json.dumps(event)}\n\n"
                            except json.JSONDecodeError:
                                pass

            if is_terminal:
                yield f"data: {json.dumps({'_stream_done': True, 'job_id': job_id})}\n\n"
                break

            # Heartbeat every 5 seconds so the connection stays alive
            heartbeat_counter += 1
            if heartbeat_counter % 10 == 0:
                yield f"data: {json.dumps({'_heartbeat': True})}\n\n"

            time.sleep(0.5)

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control":    "no-cache",
            "X-Accel-Buffering": "no",
            "Connection":        "keep-alive",
        },
    )
