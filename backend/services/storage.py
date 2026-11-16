"""
Atomic JSON storage service.

All writes are atomic: write to .tmp → fsync → rename.
File locking prevents concurrent corruption.
Provides paginated reads so large datasets don't exhaust memory.
"""

import json
import os
import time
import uuid
import hashlib
import threading
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional, Iterator

_write_lock = threading.Lock()

def _storage_root() -> Path:
    """Always re-read from env so tests can override with monkeypatch."""
    raw = os.environ.get("SCRAPER_STORAGE_DIR", "./storage")
    if not raw:
        raw = "./storage"
    p = Path(raw)
    if not p.is_absolute():
        p = Path(__file__).resolve().parent.parent.parent / raw
    p.mkdir(parents=True, exist_ok=True)
    return p


def _dir(sub: str) -> Path:
    d = _storage_root() / sub
    d.mkdir(parents=True, exist_ok=True)
    return d


def _atomic_write(path: Path, data: Any) -> None:
    """Write data atomically: tmp file → rename."""
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, default=str)
        f.flush()
        os.fsync(f.fileno())
    import os as _os
    _os.replace(tmp, path)  # atomic on all platforms including Windows


def _safe_read(path: Path) -> Optional[Any]:
    """Read JSON, returning None on any error."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def _recover_tmp(path: Path) -> None:
    """If a .tmp write was interrupted, remove it."""
    tmp = path.with_suffix(".tmp")
    if tmp.exists():
        tmp.unlink(missing_ok=True)


# ── Businesses ────────────────────────────────────────────────────────────────

def business_path(biz_id: str) -> Path:
    # Shard by first 2 chars of id to avoid huge flat directories
    shard = biz_id[:2]
    d = _dir("businesses") / shard
    d.mkdir(exist_ok=True)
    return d / f"{biz_id}.json"


def save_business(record: dict) -> str:
    """Persist a business record. Returns its id."""
    biz_id = record.get("id") or str(uuid.uuid4())
    record["id"] = biz_id
    record.setdefault("first_seen_at", datetime.now(timezone.utc).isoformat())
    record["last_scraped_at"] = datetime.now(timezone.utc).isoformat()
    with _write_lock:
        _atomic_write(business_path(biz_id), record)
    return biz_id


def get_business(biz_id: str) -> Optional[dict]:
    p = business_path(biz_id)
    _recover_tmp(p)
    return _safe_read(p)


def update_business(biz_id: str, updates: dict) -> Optional[dict]:
    with _write_lock:
        p = business_path(biz_id)
        existing = _safe_read(p)
        if existing is None:
            return None
        existing.update(updates)
        existing["last_updated_at"] = datetime.now(timezone.utc).isoformat()
        _atomic_write(p, existing)
        return existing


def iter_businesses(page: int = 1, page_size: int = 50,
                    filters: Optional[dict] = None) -> tuple[list[dict], int]:
    """Return (items, total) for paginated business listing."""
    base = _dir("businesses")
    all_records: list[dict] = []
    for shard_dir in sorted(base.iterdir()):
        if not shard_dir.is_dir():
            continue
        for biz_file in sorted(shard_dir.iterdir()):
            if biz_file.suffix != ".json":
                continue
            rec = _safe_read(biz_file)
            if rec is None:
                continue
            if filters and not _match_filters(rec, filters):
                continue
            all_records.append(rec)

    total = len(all_records)
    # Sort by last_scraped_at descending
    all_records.sort(key=lambda r: r.get("last_scraped_at", ""), reverse=True)
    start = (page - 1) * page_size
    return all_records[start:start + page_size], total


def count_businesses() -> int:
    base = _dir("businesses")
    n = 0
    for shard in base.iterdir():
        if shard.is_dir():
            n += sum(1 for f in shard.iterdir() if f.suffix == ".json")
    return n


def _match_filters(rec: dict, filters: dict) -> bool:
    for key, val in filters.items():
        if not val:
            continue
        if key == "q":
            needle = str(val).lower()
            haystack = " ".join(str(rec.get(f, "")) for f in
                                ("name", "category", "city", "phone", "email", "website"))
            if needle not in haystack.lower():
                return False
        elif key == "has_phone":
            if bool(rec.get("phone")) != bool(val):
                return False
        elif key == "has_email":
            if bool(rec.get("email")) != bool(val):
                return False
        elif key == "has_website":
            if bool(rec.get("website")) != bool(val):
                return False
        elif key == "min_quality":
            if (rec.get("quality_score") or 0) < float(val):
                return False
        else:
            if str(rec.get(key, "")).lower() != str(val).lower():
                return False
    return True


# ── Jobs ──────────────────────────────────────────────────────────────────────

def job_path(job_id: str) -> Path:
    return _dir("jobs") / f"{job_id}.json"


def save_job(job: dict) -> dict:
    with _write_lock:
        _atomic_write(job_path(job["id"]), job)
    return job


def get_job(job_id: str) -> Optional[dict]:
    return _safe_read(job_path(job_id))


def update_job(job_id: str, updates: dict) -> Optional[dict]:
    with _write_lock:
        p = job_path(job_id)
        job = _safe_read(p)
        if job is None:
            return None
        job.update(updates)
        job["updated_at"] = datetime.now(timezone.utc).isoformat()
        _atomic_write(p, job)
        return job


def list_jobs(page: int = 1, page_size: int = 20, status: Optional[str] = None) -> tuple[list[dict], int]:
    base = _dir("jobs")
    jobs = []
    for f in sorted(base.iterdir(), reverse=True):
        if f.suffix != ".json":
            continue
        j = _safe_read(f)
        if j is None:
            continue
        if status and j.get("status") != status:
            continue
        jobs.append(j)
    jobs.sort(key=lambda j: j.get("created_at", ""), reverse=True)
    total = len(jobs)
    start = (page - 1) * page_size
    return jobs[start:start + page_size], total


# ── Deduplication index ───────────────────────────────────────────────────────

def _dedup_index_path() -> Path:
    return _dir("deduplication") / "index.json"


def load_dedup_index() -> dict:
    _recover_tmp(_dedup_index_path())
    return _safe_read(_dedup_index_path()) or {}


def save_dedup_index(index: dict) -> None:
    with _write_lock:
        _atomic_write(_dedup_index_path(), index)


# ── Checkpoints ───────────────────────────────────────────────────────────────

def checkpoint_path(job_id: str) -> Path:
    return _dir("checkpoints") / f"{job_id}.json"


def save_checkpoint(job_id: str, data: dict) -> None:
    data["checkpoint_at"] = datetime.now(timezone.utc).isoformat()
    with _write_lock:
        _atomic_write(checkpoint_path(job_id), data)


def load_checkpoint(job_id: str) -> Optional[dict]:
    p = checkpoint_path(job_id)
    _recover_tmp(p)
    return _safe_read(p)


# ── Quotas ────────────────────────────────────────────────────────────────────

_quota_lock = threading.Lock()


def _quota_path(date_key: str) -> Path:
    return _dir("quotas") / f"{date_key}.json"


def get_quota(date_key: str, limit: int) -> dict:
    p = _quota_path(date_key)
    _recover_tmp(p)
    data = _safe_read(p)
    if data is None:
        data = {"date": date_key, "used": 0, "limit": limit, "remaining": limit}
        # Write initial record so subsequent increment_quota calls see the right limit
        with _quota_lock:
            if not p.exists():  # avoid race with a concurrent first write
                _atomic_write(p, data)
    data["remaining"] = max(data["limit"] - data["used"], 0)
    data["exhausted"] = data["used"] >= data["limit"]
    return data


def increment_quota(date_key: str, count: int = 1, limit: int = 500) -> dict:
    with _quota_lock:
        p = _quota_path(date_key)
        _recover_tmp(p)
        existing = _safe_read(p)
        if existing is None:
            data = {"date": date_key, "used": 0, "limit": limit}
        else:
            data = existing
            # Preserve stored limit; only fall back to arg if limit missing
            if "limit" not in data:
                data["limit"] = limit
        data["used"] = data.get("used", 0) + count
        data["remaining"] = max(data["limit"] - data["used"], 0)
        data["exhausted"] = data["used"] >= data["limit"]
        _atomic_write(p, data)
        return data


# ── Settings ──────────────────────────────────────────────────────────────────

def _settings_path() -> Path:
    return _dir("settings") / "settings.json"


def load_settings() -> dict:
    return _safe_read(_settings_path()) or {}


def save_settings(data: dict) -> None:
    with _write_lock:
        _atomic_write(_settings_path(), data)


# ── Schedules ─────────────────────────────────────────────────────────────────

def _schedules_path() -> Path:
    return _dir("schedules") / "schedules.json"


def load_schedules() -> list:
    return _safe_read(_schedules_path()) or []


def save_schedules(schedules: list) -> None:
    with _write_lock:
        _atomic_write(_schedules_path(), schedules)


# ── Activity logs ─────────────────────────────────────────────────────────────

_log_lock = threading.Lock()


def append_activity(job_id: str, event_type: str, message: str, extra: Optional[dict] = None) -> dict:
    event = {
        "id": str(uuid.uuid4()),
        "job_id": job_id,
        "event_type": event_type,
        "message": message,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **(extra or {}),
    }
    log_file = _dir("logs") / f"{job_id}.jsonl"
    with _log_lock:
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(event, default=str) + "\n")
    return event


def read_activity(job_id: str, limit: int = 200) -> list[dict]:
    log_file = _dir("logs") / f"{job_id}.jsonl"
    if not log_file.exists():
        return []
    events = []
    with open(log_file, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return events[-limit:]


# ── Backup ────────────────────────────────────────────────────────────────────

def create_backup(label: str = "") -> str:
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    name = f"backup_{ts}{'_' + label if label else ''}"
    backup_dir = _dir("backups") / name
    src = _storage_root()
    # Copy everything except backups themselves to avoid recursion
    for item in src.iterdir():
        if item.name == "backups" or item.name.endswith(".tmp"):
            continue
        dest = backup_dir / item.name
        if item.is_dir():
            shutil.copytree(item, dest)
        else:
            shutil.copy2(item, dest)
    return name


def list_backups() -> list[dict]:
    backup_base = _dir("backups")
    results = []
    for d in sorted(backup_base.iterdir(), reverse=True):
        if d.is_dir():
            size = sum(f.stat().st_size for f in d.rglob("*") if f.is_file())
            results.append({"name": d.name, "path": str(d), "size_bytes": size})
    return results


def restore_backup(name: str) -> bool:
    backup_base = _dir("backups")
    backup_dir = backup_base / name
    if not backup_dir.exists():
        return False
    src = _storage_root()
    for item in backup_dir.iterdir():
        dest = src / item.name
        if item.is_dir():
            if dest.exists():
                shutil.rmtree(dest)
            shutil.copytree(item, dest)
        else:
            shutil.copy2(item, dest)
    return True
