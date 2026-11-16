"""
Flask → Node.js worker communication client.
The Node.js scraper-engine exposes an internal HTTP API on SCRAPER_WORKER_PORT.
All requests include the internal bearer token.
"""

import os
import requests
from typing import Optional

_WORKER_PORT = int(os.environ.get("SCRAPER_WORKER_PORT", 4001))
_WORKER_TOKEN = os.environ.get("SCRAPER_WORKER_TOKEN", "dev-token")
# SCRAPER_WORKER_URL overrides the default local address — set this on Render/cloud
_WORKER_URL = os.environ.get("SCRAPER_WORKER_URL", f"http://127.0.0.1:{_WORKER_PORT}")
_BASE = _WORKER_URL.rstrip("/")
_TIMEOUT = 5


def _headers() -> dict:
    return {"Authorization": f"Bearer {_WORKER_TOKEN}", "Content-Type": "application/json"}


def dispatch_job(job_id: str) -> bool:
    """Tell the Node worker to pick up a queued job."""
    try:
        r = requests.post(f"{_BASE}/worker/dispatch",
                          json={"job_id": job_id},
                          headers=_headers(), timeout=_TIMEOUT)
        return r.status_code == 200
    except requests.RequestException:
        return False


def get_worker_health() -> dict:
    try:
        r = requests.get(f"{_BASE}/worker/health", headers=_headers(), timeout=_TIMEOUT)
        return r.json() if r.status_code == 200 else {"status": "error", "code": r.status_code}
    except requests.RequestException as e:
        return {"status": "unavailable", "error": str(e)}


def get_worker_progress(job_id: str) -> Optional[dict]:
    try:
        r = requests.get(f"{_BASE}/worker/jobs/{job_id}/progress",
                         headers=_headers(), timeout=_TIMEOUT)
        return r.json() if r.status_code == 200 else None
    except requests.RequestException:
        return None


def is_worker_available() -> bool:
    h = get_worker_health()
    return h.get("status") == "ok"
