"""
storage_pg.py — PostgreSQL drop-in replacement for all 27 storage functions.

Mirrors the exact same public API as storage.py so the router in storage.py
can delegate here transparently when STORAGE_BACKEND=postgres.

Safeguard S4: This file is ONLY imported when STORAGE_BACKEND=postgres.
              JSON storage (storage.py) remains the default and is never
              modified by this module.
Safeguard S8: All DB credentials come from db.py → environment only.
"""

import json
import math
import uuid
from datetime import datetime, timezone
from typing import Optional

from .db import get_db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Businesses ────────────────────────────────────────────────────────────────

def save_business(record: dict) -> str:
    biz_id = record.get("id") or str(uuid.uuid4())
    record["id"] = biz_id
    record.setdefault("first_seen_at", _now())
    record["last_scraped_at"] = _now()

    with get_db() as (conn, cur):
        cur.execute("""
            INSERT INTO businesses (
                id, name, category, phone, email, email_guess, website,
                street_address, city, state_region, postal_code, country,
                full_address, place_id, source_url, source, lat, lng,
                rating, review_count, price_level, hours, photos_count,
                quality_score, job_id, description, tags, ai_enriched,
                change_history, has_changes, first_seen_at, last_scraped_at
            ) VALUES (
                %(id)s,%(name)s,%(category)s,%(phone)s,%(email)s,%(email_guess)s,%(website)s,
                %(street_address)s,%(city)s,%(state_region)s,%(postal_code)s,%(country)s,
                %(full_address)s,%(place_id)s,%(source_url)s,%(source)s,%(lat)s,%(lng)s,
                %(rating)s,%(review_count)s,%(price_level)s,%(hours)s,%(photos_count)s,
                %(quality_score)s,%(job_id)s,%(description)s,%(tags)s,%(ai_enriched)s,
                %(change_history)s,%(has_changes)s,%(first_seen_at)s,%(last_scraped_at)s
            )
            ON CONFLICT (id) DO UPDATE SET
                name=EXCLUDED.name, category=EXCLUDED.category, phone=EXCLUDED.phone,
                email=EXCLUDED.email, email_guess=EXCLUDED.email_guess, website=EXCLUDED.website,
                quality_score=EXCLUDED.quality_score, last_scraped_at=EXCLUDED.last_scraped_at,
                street_address=EXCLUDED.street_address, city=EXCLUDED.city,
                full_address=EXCLUDED.full_address, rating=EXCLUDED.rating,
                review_count=EXCLUDED.review_count, hours=EXCLUDED.hours,
                ai_enriched=EXCLUDED.ai_enriched, description=EXCLUDED.description,
                tags=EXCLUDED.tags, change_history=EXCLUDED.change_history,
                has_changes=EXCLUDED.has_changes, last_scraped_at=EXCLUDED.last_scraped_at
        """, {
            **record,
            "hours":          json.dumps(record.get("hours")) if record.get("hours") else None,
            "tags":           json.dumps(record.get("tags")) if record.get("tags") else None,
            "change_history": json.dumps(record.get("change_history")) if record.get("change_history") else None,
            "ai_enriched":    record.get("ai_enriched", False),
            "has_changes":    record.get("has_changes", False),
        })
    return biz_id


def get_business(biz_id: str) -> Optional[dict]:
    with get_db() as (conn, cur):
        cur.execute("SELECT row_to_json(b) FROM businesses b WHERE id = %s", (biz_id,))
        row = cur.fetchone()
        return row[0] if row else None


def update_business(biz_id: str, updates: dict) -> Optional[dict]:
    if not updates:
        return get_business(biz_id)
    updates["last_updated_at"] = _now()
    # Build dynamic UPDATE
    set_parts = ", ".join(f"{k} = %({k})s" for k in updates)
    with get_db() as (conn, cur):
        cur.execute(f"UPDATE businesses SET {set_parts} WHERE id = %(id)s", {**updates, "id": biz_id})
        cur.execute("SELECT row_to_json(b) FROM businesses b WHERE id = %s", (biz_id,))
        row = cur.fetchone()
        return row[0] if row else None


def iter_businesses(page: int = 1, page_size: int = 50,
                    filters: Optional[dict] = None) -> tuple[list[dict], int]:
    where_clauses = []
    params: dict = {}

    if filters:
        if filters.get("q"):
            where_clauses.append(
                "to_tsvector('english', coalesce(name,'') || ' ' || coalesce(category,'') || "
                "' ' || coalesce(city,'') || ' ' || coalesce(phone,'') || ' ' || coalesce(email,'')) "
                "@@ plainto_tsquery('english', %(q)s)"
            )
            params["q"] = filters["q"]
        for col in ("city", "country", "state_region", "postal_code", "category", "source", "job_id"):
            if filters.get(col):
                where_clauses.append(f"LOWER({col}) = LOWER(%({col})s)")
                params[col] = filters[col]
        if filters.get("has_phone"):
            where_clauses.append("phone IS NOT NULL AND phone != ''")
        if filters.get("has_email"):
            where_clauses.append("email IS NOT NULL AND email != ''")
        if filters.get("has_website"):
            where_clauses.append("website IS NOT NULL AND website != ''")
        if filters.get("min_quality") is not None:
            where_clauses.append("quality_score >= %(min_quality)s")
            params["min_quality"] = float(filters["min_quality"])

    where = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
    offset = (page - 1) * page_size
    params.update({"limit": page_size, "offset": offset})

    with get_db() as (conn, cur):
        cur.execute(f"SELECT COUNT(*) FROM businesses {where}", params)
        total = cur.fetchone()[0]
        cur.execute(
            f"SELECT row_to_json(b) FROM businesses b {where} "
            f"ORDER BY last_scraped_at DESC LIMIT %(limit)s OFFSET %(offset)s",
            params,
        )
        items = [row[0] for row in cur.fetchall()]
    return items, total


def count_businesses() -> int:
    with get_db() as (conn, cur):
        cur.execute("SELECT COUNT(*) FROM businesses")
        return cur.fetchone()[0]


def business_path(biz_id: str):
    raise NotImplementedError("business_path is not used in PG backend")


# ── Jobs ──────────────────────────────────────────────────────────────────────

def save_job(job: dict) -> dict:
    with get_db() as (conn, cur):
        cur.execute("""
            INSERT INTO jobs (
                id,status,config,search_query,category,country,state_region,city,postal_code,
                source,start_index,end_index,daily_limit,job_limit,records_saved,dupes_skipped,
                failed_records,retries,progress_pct,current_index,current_business,last_error,
                worker_pid,created_at,started_at,finished_at,updated_at
            ) VALUES (
                %(id)s,%(status)s,%(config)s,%(search_query)s,%(category)s,%(country)s,
                %(state_region)s,%(city)s,%(postal_code)s,%(source)s,%(start_index)s,%(end_index)s,
                %(daily_limit)s,%(job_limit)s,%(records_saved)s,%(dupes_skipped)s,%(failed_records)s,
                %(retries)s,%(progress_pct)s,%(current_index)s,%(current_business)s,%(last_error)s,
                %(worker_pid)s,%(created_at)s,%(started_at)s,%(finished_at)s,%(updated_at)s
            )
            ON CONFLICT (id) DO NOTHING
        """, {**job, "config": json.dumps(job.get("config", {}))})
    return job


def get_job(job_id: str) -> Optional[dict]:
    with get_db() as (conn, cur):
        cur.execute("SELECT row_to_json(j) FROM jobs j WHERE id = %s", (job_id,))
        row = cur.fetchone()
        if not row:
            return None
        result = row[0]
        # config is stored as JSON string in some cases
        if isinstance(result.get("config"), str):
            try:
                result["config"] = json.loads(result["config"])
            except Exception:
                pass
        return result


def update_job(job_id: str, updates: dict) -> Optional[dict]:
    updates["updated_at"] = _now()
    set_parts = ", ".join(f"{k} = %({k})s" for k in updates)
    with get_db() as (conn, cur):
        cur.execute(f"UPDATE jobs SET {set_parts} WHERE id = %(id)s", {**updates, "id": job_id})
        cur.execute("SELECT row_to_json(j) FROM jobs j WHERE id = %s", (job_id,))
        row = cur.fetchone()
        return row[0] if row else None


def list_jobs(page: int = 1, page_size: int = 20,
              status: Optional[str] = None) -> tuple[list[dict], int]:
    where = "WHERE status = %(status)s" if status else ""
    params = {"status": status, "limit": page_size, "offset": (page - 1) * page_size}
    with get_db() as (conn, cur):
        cur.execute(f"SELECT COUNT(*) FROM jobs {where}", params)
        total = cur.fetchone()[0]
        cur.execute(
            f"SELECT row_to_json(j) FROM jobs j {where} "
            f"ORDER BY created_at DESC LIMIT %(limit)s OFFSET %(offset)s",
            params,
        )
        items = [row[0] for row in cur.fetchall()]
    return items, total


def job_path(job_id: str):
    raise NotImplementedError("job_path is not used in PG backend")


# ── Deduplication ─────────────────────────────────────────────────────────────

def load_dedup_index() -> dict:
    """Return the dedup index as a flat dict {tier:fp → business_id} for compatibility."""
    with get_db() as (conn, cur):
        cur.execute("SELECT tier, fingerprint, business_id FROM dedup_fingerprints")
        return {f"{tier}:{fp}": biz_id for tier, fp, biz_id in cur.fetchall()}


def save_dedup_index(index: dict) -> None:
    """Bulk-upsert the in-memory index dict into Neon (idempotent)."""
    import psycopg2.extras
    rows = []
    for key, biz_id in index.items():
        parts = key.split(":", 1)
        if len(parts) == 2:
            rows.append({"tier": parts[0], "fingerprint": parts[1], "business_id": biz_id})
    if not rows:
        return
    with get_db() as (conn, cur):
        psycopg2.extras.execute_batch(cur, """
            INSERT INTO dedup_fingerprints (tier, fingerprint, business_id)
            VALUES (%(tier)s, %(fingerprint)s, %(business_id)s)
            ON CONFLICT (tier, fingerprint) DO NOTHING
        """, rows)


# ── Checkpoints ───────────────────────────────────────────────────────────────

def save_checkpoint(job_id: str, data: dict) -> None:
    data["checkpoint_at"] = _now()
    with get_db() as (conn, cur):
        cur.execute("""
            INSERT INTO checkpoints (job_id, current_index, records_saved, dupes_skipped, processed_urls, checkpoint_at)
            VALUES (%(job_id)s, %(current_index)s, %(records_saved)s, %(dupes_skipped)s, %(processed_urls)s, %(checkpoint_at)s)
            ON CONFLICT (job_id) DO UPDATE SET
                current_index=EXCLUDED.current_index,
                records_saved=EXCLUDED.records_saved,
                dupes_skipped=EXCLUDED.dupes_skipped,
                processed_urls=EXCLUDED.processed_urls,
                checkpoint_at=EXCLUDED.checkpoint_at
        """, {
            "job_id":         job_id,
            "current_index":  data.get("current_index", 0),
            "records_saved":  data.get("records_saved", 0),
            "dupes_skipped":  data.get("dupes_skipped", 0),
            "processed_urls": json.dumps(list(data.get("processed_urls") or [])),
            "checkpoint_at":  data["checkpoint_at"],
        })


def load_checkpoint(job_id: str) -> Optional[dict]:
    with get_db() as (conn, cur):
        cur.execute("SELECT row_to_json(c) FROM checkpoints c WHERE job_id = %s", (job_id,))
        row = cur.fetchone()
        if not row:
            return None
        result = row[0]
        if isinstance(result.get("processed_urls"), str):
            try:
                result["processed_urls"] = json.loads(result["processed_urls"])
            except Exception:
                result["processed_urls"] = []
        return result


def checkpoint_path(job_id: str):
    raise NotImplementedError("checkpoint_path is not used in PG backend")


# ── Quotas ────────────────────────────────────────────────────────────────────

def get_quota(date_key: str, limit: int) -> dict:
    with get_db() as (conn, cur):
        cur.execute("SELECT used, lim FROM quotas WHERE date_key = %s", (date_key,))
        row = cur.fetchone()
        if not row:
            cur.execute(
                "INSERT INTO quotas (date_key, used, lim) VALUES (%s, 0, %s) ON CONFLICT DO NOTHING",
                (date_key, limit),
            )
            used, lim = 0, limit
        else:
            used, lim = row
    remaining = max(lim - used, 0)
    return {"date": date_key, "used": used, "limit": lim,
            "remaining": remaining, "exhausted": used >= lim}


def increment_quota(date_key: str, count: int = 1, limit: int = 500) -> dict:
    with get_db() as (conn, cur):
        cur.execute("""
            INSERT INTO quotas (date_key, used, lim)
            VALUES (%s, %s, %s)
            ON CONFLICT (date_key) DO UPDATE
                SET used = quotas.used + EXCLUDED.used,
                    updated_at = NOW()
            RETURNING used, lim
        """, (date_key, count, limit))
        used, lim = cur.fetchone()
    remaining = max(lim - used, 0)
    return {"date": date_key, "used": used, "limit": lim,
            "remaining": remaining, "exhausted": used >= lim}


# ── Settings ──────────────────────────────────────────────────────────────────

def load_settings() -> dict:
    with get_db() as (conn, cur):
        cur.execute("SELECT key, value FROM settings")
        return {row[0]: row[1] for row in cur.fetchall()}


def save_settings(data: dict) -> None:
    import psycopg2.extras
    rows = [{"key": k, "value": str(v)} for k, v in data.items()]
    if not rows:
        return
    with get_db() as (conn, cur):
        psycopg2.extras.execute_batch(cur, """
            INSERT INTO settings (key, value) VALUES (%(key)s, %(value)s)
            ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()
        """, rows)


# ── Schedules ─────────────────────────────────────────────────────────────────

def load_schedules() -> list:
    with get_db() as (conn, cur):
        cur.execute("SELECT row_to_json(s) FROM schedules s ORDER BY created_at")
        return [row[0] for row in cur.fetchall()]


def save_schedules(schedules: list) -> None:
    """Full replace — delete all and re-insert. Schedules list is small."""
    import psycopg2.extras
    with get_db() as (conn, cur):
        cur.execute("DELETE FROM schedules")
        if schedules:
            rows = [{
                "id": s["id"], "name": s["name"],
                "config": json.dumps(s.get("config", {})),
                "cron": s.get("cron", "0 6 * * *"),
                "enabled": s.get("enabled", True),
                "next_run": s.get("next_run"),
                "last_run": s.get("last_run"),
                "run_count": s.get("run_count", 0),
                "created_at": s.get("created_at"),
            } for s in schedules]
            psycopg2.extras.execute_batch(cur, """
                INSERT INTO schedules (id,name,config,cron,enabled,next_run,last_run,run_count,created_at)
                VALUES (%(id)s,%(name)s,%(config)s,%(cron)s,%(enabled)s,%(next_run)s,%(last_run)s,%(run_count)s,%(created_at)s)
            """, rows)


# ── Activity logs ─────────────────────────────────────────────────────────────

def append_activity(job_id: str, event_type: str, message: str,
                    extra: Optional[dict] = None) -> dict:
    event_id = str(uuid.uuid4())
    ts = _now()
    with get_db() as (conn, cur):
        cur.execute("""
            INSERT INTO activity_logs (id, job_id, event_type, message, extra, ts)
            VALUES (%s, %s, %s, %s, %s, %s)
        """, (event_id, job_id, event_type, message,
              json.dumps(extra) if extra else None, ts))
    return {"id": event_id, "job_id": job_id, "event_type": event_type,
            "message": message, "timestamp": ts}


def read_activity(job_id: str, limit: int = 200) -> list[dict]:
    with get_db() as (conn, cur):
        cur.execute("""
            SELECT row_to_json(al) FROM activity_logs al
            WHERE job_id = %s ORDER BY ts ASC LIMIT %s
        """, (job_id, limit))
        return [row[0] for row in cur.fetchall()]


# ── Backups (pg_dump based) ───────────────────────────────────────────────────

def create_backup(label: str = "") -> str:
    """
    For PG backend: record in migration_runs table.
    Full pg_dump is done separately via scripts/backup_pg.sh.
    Returns a label string.
    """
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    name = f"pg_backup_{ts}{'_' + label if label else ''}"
    with get_db() as (conn, cur):
        cur.execute("""
            INSERT INTO migration_runs (phase, status, notes)
            VALUES ('backup', 'recorded', %s)
        """, (f"Backup recorded: {name}",))
    return name


def list_backups() -> list[dict]:
    """List recorded backup events from migration_runs."""
    with get_db() as (conn, cur):
        cur.execute("""
            SELECT id, run_at, notes FROM migration_runs
            WHERE phase = 'backup' ORDER BY run_at DESC
        """)
        return [{"name": row[2], "created_at": row[1].isoformat() if row[1] else None,
                 "size_bytes": 0} for row in cur.fetchall()]


def restore_backup(name: str) -> bool:
    """PG restore requires running pg_dump/psql externally. Log the attempt."""
    with get_db() as (conn, cur):
        cur.execute("""
            INSERT INTO migration_runs (phase, status, notes)
            VALUES ('restore', 'manual_required', %s)
        """, (f"Restore requested for: {name} — run psql manually",))
    return True
