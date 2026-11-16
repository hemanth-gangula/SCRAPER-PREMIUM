"""
migrate_json_to_pg.py — Phase 2.3 idempotent JSON → PostgreSQL migration.

Safeguards:
  S2: JSON files are opened read-only — never modified or deleted.
  S3: --dry-run shows what would happen without writing; ON CONFLICT DO NOTHING
      makes re-runs safe; produces a timestamped migration_report_*.json.
  S4: Does NOT change STORAGE_BACKEND. JSON stays active.
  S8: DATABASE_URL read from environment only.

Usage:
    python migrate_json_to_pg.py --dry-run          # preview only
    python migrate_json_to_pg.py                    # migrate
    python migrate_json_to_pg.py --batch-size 50    # tune batch size
"""

import argparse
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path


# ── Helpers ───────────────────────────────────────────────────────────────────

def load_env(root: Path):
    env = root / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            if k.strip() not in os.environ:
                os.environ[k.strip()] = v.strip()


def get_db_url() -> str | None:
    return os.environ.get("DATABASE_URL_UNPOOLED") or os.environ.get("DATABASE_URL") or None


def ts() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Data loaders (read-only, S2) ──────────────────────────────────────────────

def load_all_businesses(storage: Path) -> list[dict]:
    biz_dir = storage / "businesses"
    records = []
    if not biz_dir.exists():
        return records
    for shard in sorted(biz_dir.iterdir()):
        if not shard.is_dir():
            continue
        for f in sorted(shard.glob("*.json")):
            try:
                rec = json.loads(f.read_text(encoding="utf-8"))
                records.append(rec)
            except Exception as e:
                print(f"  ⚠️  Could not parse {f}: {e}")
    return records


def load_all_jobs(storage: Path) -> list[dict]:
    jobs_dir = storage / "jobs"
    if not jobs_dir.exists():
        return []
    records = []
    for f in sorted(jobs_dir.glob("*.json")):
        try:
            records.append(json.loads(f.read_text(encoding="utf-8")))
        except Exception as e:
            print(f"  ⚠️  Could not parse {f}: {e}")
    return records


def load_dedup_index(storage: Path) -> dict:
    idx_file = storage / "deduplication" / "index.json"
    if not idx_file.exists():
        return {}
    return json.loads(idx_file.read_text(encoding="utf-8"))


def load_all_logs(storage: Path) -> list[dict]:
    logs_dir = storage / "logs"
    if not logs_dir.exists():
        return []
    events = []
    for f in sorted(logs_dir.glob("*.jsonl")):
        for line in f.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line:
                try:
                    events.append(json.loads(line))
                except Exception:
                    pass
    return events


def load_all_checkpoints(storage: Path) -> list[dict]:
    chk_dir = storage / "checkpoints"
    if not chk_dir.exists():
        return []
    records = []
    for f in sorted(chk_dir.glob("*.json")):
        try:
            records.append(json.loads(f.read_text(encoding="utf-8")))
        except Exception:
            pass
    return records


def load_all_quotas(storage: Path) -> list[dict]:
    quota_dir = storage / "quotas"
    if not quota_dir.exists():
        return []
    records = []
    for f in sorted(quota_dir.glob("*.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            # date_key comes from filename if not in file
            if "date" in data and "date_key" not in data:
                data["date_key"] = data["date"]
            elif "date_key" not in data:
                data["date_key"] = f.stem
            records.append(data)
        except Exception:
            pass
    return records


def load_settings(storage: Path) -> list[dict]:
    sf = storage / "settings" / "settings.json"
    if not sf.exists():
        return []
    try:
        data = json.loads(sf.read_text(encoding="utf-8"))
        return [{"key": k, "value": str(v)} for k, v in data.items()]
    except Exception:
        return []


def load_schedules(storage: Path) -> list[dict]:
    sf = storage / "schedules" / "schedules.json"
    if not sf.exists():
        return []
    try:
        data = json.loads(sf.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


# ── Dry-run report ────────────────────────────────────────────────────────────

def dry_run_report(storage: Path, db_url: str | None) -> dict:
    businesses  = load_all_businesses(storage)
    jobs        = load_all_jobs(storage)
    dedup_idx   = load_dedup_index(storage)
    logs        = load_all_logs(storage)
    checkpoints = load_all_checkpoints(storage)
    quotas      = load_all_quotas(storage)
    settings    = load_settings(storage)
    schedules   = load_schedules(storage)

    report = {
        "dry_run": True,
        "timestamp": ts(),
        "source": "json",
        "destination": "neon_postgres" if db_url else "NOT_CONFIGURED",
        "would_insert": {
            "jobs":              len(jobs),
            "businesses":        len(businesses),
            "dedup_fingerprints": len(dedup_idx),
            "activity_logs":     len(logs),
            "checkpoints":       len(checkpoints),
            "quotas":            len(quotas),
            "settings":          len(settings),
            "schedules":         len(schedules),
        },
        "notes": [],
    }

    if not db_url:
        report["notes"].append("DATABASE_URL not configured — live migration would be skipped")

    print("\n=== DRY RUN — no data will be written ===")
    print(f"  Source: {storage}")
    print(f"  Target: {'Neon PostgreSQL' if db_url else 'NOT CONFIGURED (set DATABASE_URL)'}")
    print()
    for entity, count in report["would_insert"].items():
        print(f"  Would insert:  {entity:<25} {count:>6} rows")
    print()
    if not db_url:
        print("  ⚠️  DATABASE_URL not set — live migration skipped in dry run too")
    print("=== Dry run complete — review above and run without --dry-run to proceed ===\n")
    return report


# ── Live migration ────────────────────────────────────────────────────────────

def migrate(storage: Path, db_url: str, batch_size: int) -> dict:
    import psycopg2
    import psycopg2.extras

    report = {
        "dry_run":   False,
        "timestamp": ts(),
        "source":    str(storage),
        "counts": {},
        "errors": [],
        "status": "started",
    }

    def insert_batch(cur, sql: str, rows: list, entity: str) -> int:
        if not rows:
            return 0
        inserted = 0
        for i in range(0, len(rows), batch_size):
            batch = rows[i:i + batch_size]
            savepoint = f"sp_{entity}_{i}"
            try:
                cur.execute(f"SAVEPOINT {savepoint}")
                psycopg2.extras.execute_batch(cur, sql, batch, page_size=batch_size)
                cur.execute(f"RELEASE SAVEPOINT {savepoint}")
                inserted += len(batch)
            except Exception as e:
                cur.execute(f"ROLLBACK TO SAVEPOINT {savepoint}")
                report["errors"].append(f"{entity} batch {i//batch_size}: {e}")
        return inserted

    conn = psycopg2.connect(db_url)
    conn.autocommit = False
    cur = conn.cursor()

    try:
        # ── jobs (first — businesses FK depends on it) ────────────────────────
        jobs = load_all_jobs(storage)
        job_rows = []
        for j in jobs:
            job_rows.append({
                "id": j["id"], "status": j.get("status","queued"),
                "config": json.dumps(j.get("config",{})),
                "search_query": j.get("search_query"), "category": j.get("category"),
                "country": j.get("country"), "state_region": j.get("state_region"),
                "city": j.get("city"), "postal_code": j.get("postal_code"),
                "source": j.get("source","google_maps"),
                "start_index": j.get("start_index",1), "end_index": j.get("end_index",100),
                "daily_limit": j.get("daily_limit",500), "job_limit": j.get("job_limit",100),
                "records_saved": j.get("records_saved",0), "dupes_skipped": j.get("dupes_skipped",0),
                "failed_records": j.get("failed_records",0), "retries": j.get("retries",0),
                "progress_pct": j.get("progress_pct",0), "current_index": j.get("current_index",0),
                "current_business": j.get("current_business"), "last_error": j.get("last_error"),
                "worker_pid": j.get("worker_pid"),
                "created_at": j.get("created_at"), "started_at": j.get("started_at"),
                "finished_at": j.get("finished_at"), "updated_at": j.get("updated_at"),
            })
        n_jobs = insert_batch(cur, """
            INSERT INTO jobs (id,status,config,search_query,category,country,state_region,
                city,postal_code,source,start_index,end_index,daily_limit,job_limit,
                records_saved,dupes_skipped,failed_records,retries,progress_pct,current_index,
                current_business,last_error,worker_pid,created_at,started_at,finished_at,updated_at)
            VALUES (%(id)s,%(status)s,%(config)s,%(search_query)s,%(category)s,%(country)s,
                %(state_region)s,%(city)s,%(postal_code)s,%(source)s,%(start_index)s,%(end_index)s,
                %(daily_limit)s,%(job_limit)s,%(records_saved)s,%(dupes_skipped)s,%(failed_records)s,
                %(retries)s,%(progress_pct)s,%(current_index)s,%(current_business)s,%(last_error)s,
                %(worker_pid)s,%(created_at)s,%(started_at)s,%(finished_at)s,%(updated_at)s)
            ON CONFLICT (id) DO NOTHING
        """, job_rows, "jobs")
        report["counts"]["jobs"] = {"json": len(jobs), "inserted": n_jobs}
        print(f"  jobs:               {n_jobs}/{len(jobs)} inserted (ON CONFLICT DO NOTHING)")

        # ── businesses ────────────────────────────────────────────────────────
        businesses = load_all_businesses(storage)
        biz_rows = []
        for b in businesses:
            biz_rows.append({
                "id": b["id"], "name": b.get("name",""), "category": b.get("category"),
                "phone": b.get("phone"), "email": b.get("email"), "email_guess": b.get("email_guess"),
                "website": b.get("website"), "street_address": b.get("street_address"),
                "city": b.get("city"), "state_region": b.get("state_region"),
                "postal_code": b.get("postal_code"), "country": b.get("country"),
                "full_address": b.get("full_address"), "place_id": b.get("place_id"),
                "source_url": b.get("source_url"), "source": b.get("source","google_maps"),
                "lat": b.get("lat"), "lng": b.get("lng"),
                "rating": b.get("rating"), "review_count": b.get("review_count"),
                "price_level": b.get("price_level"),
                "hours": json.dumps(b.get("hours")) if b.get("hours") else None,
                "photos_count": b.get("photos_count"),
                "quality_score": b.get("quality_score",0),
                "job_id": b.get("job_id"),
                "description": b.get("description"),
                "tags": json.dumps(b.get("tags")) if b.get("tags") else None,
                "ai_enriched": b.get("ai_enriched", False),
                "change_history": json.dumps(b.get("change_history")) if b.get("change_history") else None,
                "has_changes": b.get("has_changes", False),
                "first_seen_at": b.get("first_seen_at"), "last_scraped_at": b.get("last_scraped_at"),
                "last_updated_at": b.get("last_updated_at"),
            })
        n_biz = insert_batch(cur, """
            INSERT INTO businesses (id,name,category,phone,email,email_guess,website,
                street_address,city,state_region,postal_code,country,full_address,place_id,
                source_url,source,lat,lng,rating,review_count,price_level,hours,photos_count,
                quality_score,job_id,description,tags,ai_enriched,change_history,has_changes,
                first_seen_at,last_scraped_at,last_updated_at)
            VALUES (%(id)s,%(name)s,%(category)s,%(phone)s,%(email)s,%(email_guess)s,%(website)s,
                %(street_address)s,%(city)s,%(state_region)s,%(postal_code)s,%(country)s,
                %(full_address)s,%(place_id)s,%(source_url)s,%(source)s,%(lat)s,%(lng)s,
                %(rating)s,%(review_count)s,%(price_level)s,%(hours)s,%(photos_count)s,
                %(quality_score)s,%(job_id)s,%(description)s,%(tags)s,%(ai_enriched)s,
                %(change_history)s,%(has_changes)s,%(first_seen_at)s,%(last_scraped_at)s,
                %(last_updated_at)s)
            ON CONFLICT (id) DO NOTHING
        """, biz_rows, "businesses")
        report["counts"]["businesses"] = {"json": len(businesses), "inserted": n_biz}
        print(f"  businesses:         {n_biz}/{len(businesses)} inserted")

        # ── dedup fingerprints ────────────────────────────────────────────────
        dedup_idx = load_dedup_index(storage)
        fp_rows = []
        for key, biz_id in dedup_idx.items():
            parts = key.split(":", 1)
            if len(parts) == 2:
                fp_rows.append({"tier": parts[0], "fingerprint": parts[1], "business_id": biz_id})
        n_dedup = insert_batch(cur, """
            INSERT INTO dedup_fingerprints (tier, fingerprint, business_id)
            VALUES (%(tier)s, %(fingerprint)s, %(business_id)s)
            ON CONFLICT (tier, fingerprint) DO NOTHING
        """, fp_rows, "dedup")
        report["counts"]["dedup_fingerprints"] = {"json": len(dedup_idx), "inserted": n_dedup}
        print(f"  dedup_fingerprints: {n_dedup}/{len(dedup_idx)} inserted")

        # ── activity logs ─────────────────────────────────────────────────────
        logs = load_all_logs(storage)
        log_rows = []
        from datetime import datetime, timezone
        for ev in logs:
            # Handle missing id — generate one if absent
            ev_id = ev.get("id") or str(uuid.uuid4())
            # Handle both 'timestamp' and 'ts' field names; default to now() if missing
            ev_ts = (ev.get("timestamp") or ev.get("ts")
                     or datetime.now(timezone.utc).isoformat())
            log_rows.append({
                "id": ev_id, "job_id": ev.get("job_id"),
                "event_type": ev.get("event_type", "unknown"),
                "message": ev.get("message", ""),
                "extra": json.dumps({k: v for k, v in ev.items()
                           if k not in ("id", "job_id", "event_type", "message",
                                        "timestamp", "ts")}),
                "ts": ev_ts,
            })
        n_logs = insert_batch(cur, """
            INSERT INTO activity_logs (id, job_id, event_type, message, extra, ts)
            VALUES (%(id)s, %(job_id)s, %(event_type)s, %(message)s, %(extra)s, %(ts)s)
            ON CONFLICT (id) DO NOTHING
        """, log_rows, "logs")
        report["counts"]["activity_logs"] = {"json": len(logs), "inserted": n_logs}
        print(f"  activity_logs:      {n_logs}/{len(logs)} inserted")

        # ── checkpoints ───────────────────────────────────────────────────────
        checkpoints = load_all_checkpoints(storage)
        chk_rows = []
        for c in checkpoints:
            chk_rows.append({
                "job_id": c.get("job_id"), "current_index": c.get("current_index",0),
                "records_saved": c.get("records_saved",0), "dupes_skipped": c.get("dupes_skipped",0),
                "processed_urls": json.dumps(list(c.get("processed_urls") or [])),
                "checkpoint_at": c.get("checkpoint_at") or c.get("saved_at"),
            })
        n_chk = insert_batch(cur, """
            INSERT INTO checkpoints (job_id,current_index,records_saved,dupes_skipped,processed_urls,checkpoint_at)
            VALUES (%(job_id)s,%(current_index)s,%(records_saved)s,%(dupes_skipped)s,%(processed_urls)s,%(checkpoint_at)s)
            ON CONFLICT (job_id) DO NOTHING
        """, chk_rows, "checkpoints")
        report["counts"]["checkpoints"] = {"json": len(checkpoints), "inserted": n_chk}
        print(f"  checkpoints:        {n_chk}/{len(checkpoints)} inserted")

        # ── quotas ────────────────────────────────────────────────────────────
        quotas = load_all_quotas(storage)
        quota_rows = [{"date_key": q["date_key"], "used": q.get("used",0),
                       "lim": q.get("limit", q.get("lim",500))} for q in quotas]
        n_quotas = insert_batch(cur, """
            INSERT INTO quotas (date_key, used, lim)
            VALUES (%(date_key)s, %(used)s, %(lim)s)
            ON CONFLICT (date_key) DO NOTHING
        """, quota_rows, "quotas")
        report["counts"]["quotas"] = {"json": len(quotas), "inserted": n_quotas}
        print(f"  quotas:             {n_quotas}/{len(quotas)} inserted")

        # ── settings ──────────────────────────────────────────────────────────
        settings = load_settings(storage)
        n_settings = insert_batch(cur, """
            INSERT INTO settings (key, value)
            VALUES (%(key)s, %(value)s)
            ON CONFLICT (key) DO NOTHING
        """, settings, "settings")
        report["counts"]["settings"] = {"json": len(settings), "inserted": n_settings}
        print(f"  settings:           {n_settings}/{len(settings)} inserted")

        # ── schedules ─────────────────────────────────────────────────────────
        schedules = load_schedules(storage)
        sched_rows = []
        for s in schedules:
            sched_rows.append({
                "id": s["id"], "name": s["name"], "config": json.dumps(s.get("config",{})),
                "cron": s.get("cron","0 6 * * *"), "enabled": s.get("enabled", True),
                "next_run": s.get("next_run"), "last_run": s.get("last_run"),
                "run_count": s.get("run_count",0), "created_at": s.get("created_at"),
            })
        n_sched = insert_batch(cur, """
            INSERT INTO schedules (id,name,config,cron,enabled,next_run,last_run,run_count,created_at)
            VALUES (%(id)s,%(name)s,%(config)s,%(cron)s,%(enabled)s,%(next_run)s,%(last_run)s,%(run_count)s,%(created_at)s)
            ON CONFLICT (id) DO NOTHING
        """, sched_rows, "schedules")
        report["counts"]["schedules"] = {"json": len(schedules), "inserted": n_sched}
        print(f"  schedules:          {n_sched}/{len(schedules)} inserted")

        # ── Record migration run ───────────────────────────────────────────────
        cur.execute("""
            INSERT INTO migration_runs (phase, status, counts_json, notes)
            VALUES (%s, %s, %s, %s)
        """, ("migrate", "completed", json.dumps(report["counts"]), "migrate_json_to_pg.py"))

        conn.commit()
        report["status"] = "completed"
        print("\n✅ Migration committed to Neon.")

    except Exception as e:
        conn.rollback()
        report["status"] = "failed"
        report["errors"].append(str(e))
        print(f"\n❌ Migration failed (rolled back): {e}")
    finally:
        conn.close()

    # Write report (S3)
    report_dir = Path(__file__).parent
    report_name = f"migration_report_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}.json"
    report_path = report_dir / report_name
    report_path.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    print(f"\nReport saved: {report_path}")
    return report


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    root = Path(__file__).resolve().parent.parent.parent
    load_env(root)

    parser = argparse.ArgumentParser(description="Migrate JSON storage to Neon PostgreSQL")
    parser.add_argument("--dry-run",    action="store_true", help="Preview without writing")
    parser.add_argument("--batch-size", type=int, default=100, help="Rows per batch (default 100)")
    parser.add_argument(
        "--storage-dir",
        default=None,
        help="Path to storage root (defaults to SCRAPER_STORAGE_DIR env var)",
    )
    args = parser.parse_args()

    raw = args.storage_dir or os.environ.get("SCRAPER_STORAGE_DIR", "./storage")
    storage = Path(raw) if Path(raw).is_absolute() else root / raw

    db_url = get_db_url()

    if args.dry_run:
        report = dry_run_report(storage, db_url)
        # Save dry-run report too
        report_path = Path(__file__).parent / f"migration_report_dryrun_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}.json"
        report_path.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
        print(f"Dry-run report saved: {report_path}")
        sys.exit(0)

    if not db_url:
        print("⚠️  DATABASE_URL not set — migration skipped.")
        print("   Set DATABASE_URL or DATABASE_URL_UNPOOLED in .env to run against Neon.")
        sys.exit(0)

    try:
        import psycopg2  # noqa: F401
    except ImportError:
        print("❌ psycopg2 not installed. Run: pip install psycopg2-binary==2.9.9")
        sys.exit(1)

    report = migrate(storage, db_url, args.batch_size)
    sys.exit(0 if report["status"] == "completed" else 1)


if __name__ == "__main__":
    main()
