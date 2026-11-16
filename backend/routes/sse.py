"""
Server-Sent Events endpoint for live job progress.
Frontend subscribes to /api/events/<job_id> and gets real-time updates.
"""

import json
import time
from flask import Blueprint, Response, request
from services.storage import get_job
from services.worker_client import get_worker_progress

bp = Blueprint("sse", __name__)


@bp.get("/events/<job_id>")
def job_events(job_id):
    def generate():
        last_status = None
        last_saved = -1
        empty_polls = 0

        while True:
            job = get_job(job_id)
            if not job:
                yield f"data: {json.dumps({'error': 'job not found'})}\n\n"
                break

            # Merge live worker data
            live = get_worker_progress(job_id)
            if live:
                job.update(live)

            status = job.get("status")
            saved = job.get("records_saved", 0)

            if status != last_status or saved != last_saved:
                payload = {
                    "job_id":        job_id,
                    "status":        status,
                    "records_saved": saved,
                    "dupes_skipped": job.get("dupes_skipped", 0),
                    "progress_pct":  job.get("progress_pct", 0),
                    "current_index": job.get("current_index", 0),
                    "current_business": job.get("current_business"),
                    "last_error":    job.get("last_error"),
                }
                yield f"data: {json.dumps(payload)}\n\n"
                last_status = status
                last_saved = saved
                empty_polls = 0
            else:
                # Heartbeat every 10 empty polls (5 seconds)
                empty_polls += 1
                if empty_polls % 10 == 0:
                    yield f"data: {json.dumps({'heartbeat': True, 'job_id': job_id})}\n\n"

            if status in ("completed", "failed", "cancelled"):
                break

            time.sleep(0.5)

    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
