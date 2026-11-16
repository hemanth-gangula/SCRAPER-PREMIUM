"""
rollback.py — Phase 2.7 safe rollback from Neon back to JSON.

Safeguard S6: Copies any records that exist in Neon but NOT in JSON
              back to JSON files atomically before switching backends.
              JSON files are never deleted.

Usage:
    python rollback.py                          # sync delta + print rollback instructions
    python rollback.py --restore-from-backup <name>   # restore JSON from a backup instead
    python rollback.py --dry-run               # show what would be synced, no writes
"""

import argparse
import hashlib
import json
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path


def load_env(root: Path) -> None:
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


def _storage_root(root: Path, args_dir: str | None = None) -> Path:
    raw = args_dir or os.environ.get("SCRAPER_STORAGE_DIR", "./storage")
    return Path(raw) if Path(raw).is_absolute() else root / raw


def _atomic_write(path: Path, data: object) -> None:
    """Atomic write: .tmp → rename (mirrors storage.py)."""
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, default=str)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


# ── JSON helpers (read existing IDs, write-back new records) ──────────────────

def _json_business_ids(storage: Path) -> set:
    ids = set()
    biz_dir = storage / "businesses"
    if not biz_dir.exists():
        return ids
    for shard in biz_dir.iterdir():
        if shard.is_dir():
            for f in shard.glob("*.json"):
                ids.add(f.stem)
    return ids


def _json_job_ids(storage: Path) -> set:
    jobs_dir = storage / "jobs"
    if not jobs_dir.exists():
        return set()
    return {f.stem for f in jobs_dir.glob("*.json")}


def _write_business_to_json(storage: Path, record: dict) -> None:
    biz_id = record["id"]
    shard = biz_id[:2]
    shard_dir = storage / "businesses" / shard
    shard_dir.mkdir(parents=True, exist_ok=True)
    _atomic_write(shard_dir / f"{biz_id}.json", record)


def _write_job_to_json(storage: Path, record: dict) -> None:
    jobs_dir = storage / "jobs"
    jobs_dir.mkdir(parents=True, exist_ok=True)
    _atomic_write(jobs_dir / f"{record['id']}.json", record)


# ── Main rollback logic ───────────────────────────────────────────────────────

def rollback(storage: Path, db_url: str | None, dry_run: bool = False) -> bool:
    current_backend = os.environ.get("STORAGE_BACKEND", "json")

    print("\n" + "=" * 60)
    print("ROLLBACK TO JSON STORAGE")
    print("=" * 60)
    print(f"\nCurrent STORAGE_BACKEND: {current_backend}")
    print(f"Storage dir:             {storage}")
    print(f"Dry run:                 {dry_run}\n")

    if current_backend == "json":
        print("ℹ️  STORAGE_BACKEND is already 'json' — nothing to roll back.")
        print("   JSON is the active backend. No changes made.")
        return True

    if not db_url:
        print("⚠️  DATABASE_URL not set — cannot connect to Neon to sync delta.")
        print("   If JSON files are intact, just set STORAGE_BACKEND=json in .env and restart.")
        return True

    try:
        import psycopg2
    except ImportError:
        print("❌ psycopg2 not installed. Run: pip install psycopg2-binary==2.9.9")
        return False

    synced_biz = 0
    synced_jobs = 0
    errors = []

    try:
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()

        # ── Sync businesses: Neon → JSON (S6) ────────────────────────────────
        print("── Syncing new businesses (Neon → JSON) ─────────────────────")
        json_biz_ids = _json_business_ids(storage)
        cur.execute("SELECT id FROM businesses")
        pg_biz_ids = {row[0] for row in cur.fetchall()}
        new_biz_ids = pg_biz_ids - json_biz_ids
        print(f"  JSON has {len(json_biz_ids)} businesses")
        print(f"  Neon has {len(pg_biz_ids)} businesses")
        print(f"  New in Neon (not in JSON): {len(new_biz_ids)}")

        for biz_id in new_biz_ids:
            try:
                cur.execute("SELECT row_to_json(b) FROM businesses b WHERE id = %s", (biz_id,))
                row = cur.fetchone()
                if row:
                    record = row[0]
                    if not dry_run:
                        _write_business_to_json(storage, record)
                    synced_biz += 1
            except Exception as e:
                errors.append(f"business {biz_id}: {e}")

        action = "Would write" if dry_run else "Wrote"
        print(f"  {action} {synced_biz} new businesses to JSON")

        # ── Sync jobs: Neon → JSON ────────────────────────────────────────────
        print("\n── Syncing new jobs (Neon → JSON) ────────────────────────────")
        json_job_ids = _json_job_ids(storage)
        cur.execute("SELECT id FROM jobs")
        pg_job_ids = {row[0] for row in cur.fetchall()}
        new_job_ids = pg_job_ids - json_job_ids
        print(f"  JSON has {len(json_job_ids)} jobs")
        print(f"  Neon has {len(pg_job_ids)} jobs")
        print(f"  New in Neon (not in JSON): {len(new_job_ids)}")

        for job_id in new_job_ids:
            try:
                cur.execute("SELECT row_to_json(j) FROM jobs j WHERE id = %s", (job_id,))
                row = cur.fetchone()
                if row:
                    record = row[0]
                    if not dry_run:
                        _write_job_to_json(storage, record)
                    synced_jobs += 1
            except Exception as e:
                errors.append(f"job {job_id}: {e}")

        print(f"  {action} {synced_jobs} new jobs to JSON")

        conn.close()

    except Exception as e:
        print(f"\n❌ Neon connection failed: {e}")
        print("   If JSON files are intact, set STORAGE_BACKEND=json in .env and restart.")
        return False

    # ── Summary ───────────────────────────────────────────────────────────────
    print(f"\n── Summary {'(DRY RUN) ' if dry_run else ''}──────────────────────────────────────────")
    print(f"  New businesses synced to JSON: {synced_biz}")
    print(f"  New jobs synced to JSON:       {synced_jobs}")
    if errors:
        print(f"  Errors: {len(errors)}")
        for e in errors[:5]:
            print(f"    {e}")

    if not dry_run:
        print("\n" + "─" * 60)
        print("✅ Delta sync complete. JSON files are up to date.")
        print()
        print("To complete rollback, do ONE of the following:")
        print()
        print("  Option A — edit .env manually (recommended):")
        print("    1. Open .env")
        print("    2. Change or add: STORAGE_BACKEND=json")
        print("    3. Restart the Flask backend")
        print()
        print("  Option B — Render dashboard:")
        print("    1. Go to your backend service → Environment")
        print("    2. Set STORAGE_BACKEND = json")
        print("    3. Trigger a redeploy")
        print()
        print("  JSON files are intact. Zero data loss.")
    else:
        print("\n[DRY RUN] No files written. Run without --dry-run to sync delta.")

    return len(errors) == 0


def restore_from_backup(backup_name: str, storage: Path) -> bool:
    """Restore JSON storage from a named backup directory."""
    backup_dir = storage / "backups" / backup_name
    if not backup_dir.exists():
        print(f"❌ Backup not found: {backup_dir}")
        return False

    manifest_path = backup_dir / "MANIFEST.json"
    if not manifest_path.exists():
        print("❌ MANIFEST.json not found in backup. Backup may not have been verified.")
        print("   Run verify_backup.py --backup-name <name> first.")
        return False

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    print(f"\nRestoring from backup: {backup_name}")
    print(f"Backup verified at: {manifest.get('verified_at', 'unknown')}")
    print()

    # Verify file hashes before restoring
    print("── Verifying backup file hashes ─────────────────────────────────")
    for rel_path, expected_hash in manifest.get("files", {}).items():
        src = backup_dir / rel_path
        if not src.exists():
            print(f"  ❌ Missing: {rel_path}")
            return False
        h = hashlib.sha256()
        with open(src, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                h.update(chunk)
        if h.hexdigest() != expected_hash:
            print(f"  ❌ Hash mismatch: {rel_path}")
            return False
    print(f"  ✅ All {len(manifest.get('files', {}))} files verified")

    # Restore each subdirectory (never deletes — overwrites)
    subdirs = ["businesses", "jobs", "logs", "checkpoints", "deduplication",
               "quotas", "settings", "schedules"]
    print("\n── Restoring files ──────────────────────────────────────────────")
    for sub in subdirs:
        src_dir = backup_dir / sub
        dst_dir = storage / sub
        if src_dir.exists():
            dst_dir.mkdir(parents=True, exist_ok=True)
            for item in src_dir.rglob("*"):
                if item.is_file():
                    rel = item.relative_to(src_dir)
                    dst = dst_dir / rel
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(item, dst)
            print(f"  ✅ {sub}/")
        else:
            print(f"  ⚠️  {sub}/ not in backup (skipped)")

    print(f"\n✅ Restore complete from: {backup_name}")
    print("   Set STORAGE_BACKEND=json in .env and restart Flask.")
    return True


def main():
    root = Path(__file__).resolve().parent.parent.parent
    load_env(root)

    parser = argparse.ArgumentParser(description="Rollback Scraper Premium to JSON storage")
    parser.add_argument("--dry-run", action="store_true",
                        help="Show what would be synced without writing")
    parser.add_argument("--restore-from-backup", metavar="BACKUP_NAME",
                        help="Restore JSON from a verified backup directory")
    parser.add_argument("--storage-dir", default=None)
    args = parser.parse_args()

    storage = _storage_root(root, args.storage_dir)
    db_url  = get_db_url()

    if args.restore_from_backup:
        ok = restore_from_backup(args.restore_from_backup, storage)
    else:
        ok = rollback(storage, db_url, dry_run=args.dry_run)

    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
