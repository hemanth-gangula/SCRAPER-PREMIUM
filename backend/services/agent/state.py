"""
Agent session state persistence.

Sessions are stored as JSON files in storage/agent_sessions/.
Each session keeps the full message history and any tracked job IDs.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path
from typing import Any

from config import config

SESSIONS_DIR = Path(config.STORAGE_DIR) / "agent_sessions"


def _ensure_dir() -> None:
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)


def _session_path(session_id: str) -> Path:
    return SESSIONS_DIR / f"{session_id}.json"


def create_session(title: str = "", provider: str = "", model: str = "") -> dict:
    """Create a new agent session. Returns the full session dict."""
    _ensure_dir()
    session_id = str(uuid.uuid4())
    now = time.time()
    session = {
        "id":         session_id,
        "title":      title or "New Session",
        "provider":   provider,
        "model":      model,
        "created_at": now,
        "updated_at": now,
        "messages":   [],           # full chat history
        "job_ids":    [],           # job IDs created in this session
        "metadata":   {},
    }
    _write_session(session)
    return session


def get_session(session_id: str) -> dict | None:
    """Load session by ID. Returns None if not found."""
    path = _session_path(session_id)
    if not path.exists():
        return None
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def update_session(session_id: str, **kwargs) -> dict | None:
    """Update fields on a session. Returns updated session or None."""
    session = get_session(session_id)
    if session is None:
        return None
    session.update(kwargs)
    session["updated_at"] = time.time()
    _write_session(session)
    return session


def append_message(session_id: str, message: dict) -> dict | None:
    """Append a single message to session history. Returns updated session."""
    session = get_session(session_id)
    if session is None:
        return None
    session["messages"].append(message)
    session["updated_at"] = time.time()

    # Auto-title session from first user message
    if not session["title"] or session["title"] == "New Session":
        user_msgs = [m for m in session["messages"] if m.get("role") == "user"]
        if user_msgs:
            first = user_msgs[0].get("content", "")
            if isinstance(first, str):
                session["title"] = first[:60] + ("…" if len(first) > 60 else "")

    _write_session(session)
    return session


def track_job(session_id: str, job_id: str) -> None:
    """Record a job ID as created by this session."""
    session = get_session(session_id)
    if session and job_id not in session["job_ids"]:
        session["job_ids"].append(job_id)
        session["updated_at"] = time.time()
        _write_session(session)


def list_sessions(limit: int = 50) -> list[dict]:
    """Return recent sessions, newest first, without full message history."""
    _ensure_dir()
    sessions = []
    for path in sorted(SESSIONS_DIR.glob("*.json"), key=os.path.getmtime, reverse=True):
        try:
            with path.open("r", encoding="utf-8") as f:
                s = json.load(f)
            # Strip messages to keep response small
            sessions.append({
                "id":           s["id"],
                "title":        s.get("title", "Untitled"),
                "provider":     s.get("provider", ""),
                "model":        s.get("model", ""),
                "created_at":   s.get("created_at"),
                "updated_at":   s.get("updated_at"),
                "message_count": len(s.get("messages", [])),
                "job_ids":      s.get("job_ids", []),
            })
        except Exception:
            continue
        if len(sessions) >= limit:
            break
    return sessions


def delete_session(session_id: str) -> bool:
    """Delete a session file. Returns True if deleted."""
    path = _session_path(session_id)
    if path.exists():
        path.unlink()
        return True
    return False


def _write_session(session: dict) -> None:
    """Atomic write (write to .tmp then rename). Falls back to direct write on Windows rename errors."""
    _ensure_dir()
    path = _session_path(session["id"])
    tmp = path.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(session, f, indent=2, default=str)
    try:
        tmp.replace(path)
    except (PermissionError, OSError):
        # OneDrive or antivirus may lock the .tmp file momentarily on Windows.
        # Fall back to a direct overwrite — slightly less atomic but safe for our use case.
        import shutil
        try:
            shutil.copy2(str(tmp), str(path))
            tmp.unlink(missing_ok=True)
        except Exception:
            # Last resort: write directly
            with path.open("w", encoding="utf-8") as f:
                json.dump(session, f, indent=2, default=str)
            tmp.unlink(missing_ok=True)
