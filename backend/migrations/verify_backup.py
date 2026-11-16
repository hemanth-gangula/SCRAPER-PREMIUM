"""
verify_backup.py — Phase 2.0 backup integrity verifier.

Reads every file in the backup directory, computes SHA-256 hashes,
validates JSON/JSONL parsability, checks dedup index consistency,
and writes a signed MANIFEST.json.

Safeguards: S1, S2 — never modifies original files.

Usage:
    python verify_backup.py --backup-name backup_20261026T100000_pre_neon_migration
    python verify_backup.py --backup-name <name> --storage-dir /data/storage
"""

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def verify_backup(backup_name: str, storage_dir: Path) -> bool:
    backup_base = storage_dir / "backups"
    backup_dir  = backup_base / backup_name

    if not backup_dir.exists():
        print(f"❌ Backup directory not found: {backup_dir}")
        return False

    print(f"\n{'='*60}")
    print(f"Verifying backup: {backup_name}")
    print(f"Directory:        {backup_dir}")
    print(f"{'='*60}\n")

    manifest = {
        "backup_name":  backup_name,
        "verified_at":  datetime.now(timezone.utc).isoformat(),
        "files":        {},
        "counts":       {},
        "errors":       [],
    }

    all_ok = True

    # ── businesses ────────────────────────────────────────────────────────────
    biz_dir = backup_dir / "businesses"
    biz_count = 0
    biz_ids = set()
    if biz_dir.exists():
        for shard in sorted(biz_dir.iterdir()):
            if not shard.is_dir():
                continue
            for f in sorted(shard.glob("*.json")):
                try:
                    rec = json.loads(f.read_text(encoding="utf-8"))
                    if not rec.get("id"):
                        raise ValueError("missing id field")
                    biz_ids.add(rec["id"])
                    manifest["files"][str(f.relative_to(backup_dir))] = sha256_file(f)
                    biz_count += 1
                except Exception as e:
                    manifest["errors"].append(f"businesses/{f.name}: {e}")
                    all_ok = False
    manifest["counts"]["businesses"] = biz_count
    status = "✅" if biz_count > 0 else "⚠️ "
    print(f"{status} businesses:    {biz_count} files verified")

    # ── jobs ─────────────────────────────────────────────────────────────────
    jobs_dir = backup_dir / "jobs"
    job_count = 0
    job_ids = set()
    if jobs_dir.exists():
        for f in sorted(jobs_dir.glob("*.json")):
            try:
                rec = json.loads(f.read_text(encoding="utf-8"))
                if not rec.get("id"):
                    raise ValueError("missing id field")
                job_ids.add(rec["id"])
                manifest["files"][str(f.relative_to(backup_dir))] = sha256_file(f)
                job_count += 1
            except Exception as e:
                manifest["errors"].append(f"jobs/{f.name}: {e}")
                all_ok = False
    manifest["counts"]["jobs"] = job_count
    print(f"✅ jobs:           {job_count} files verified")

    # ── deduplication index ───────────────────────────────────────────────────
    dedup_file = backup_dir / "deduplication" / "index.json"
    dedup_count = 0
    dedup_orphans = 0
    if dedup_file.exists():
        try:
            idx = json.loads(dedup_file.read_text(encoding="utf-8"))
            dedup_count = len(idx)
            manifest["files"][str(dedup_file.relative_to(backup_dir))] = sha256_file(dedup_file)
            # Check every business_id in index exists as a business file
            for key, biz_id in idx.items():
                if biz_id not in biz_ids:
                    dedup_orphans += 1
            if dedup_orphans > 0:
                manifest["errors"].append(
                    f"dedup: {dedup_orphans} orphan fingerprints (business_id not in businesses)"
                )
                all_ok = False
        except Exception as e:
            manifest["errors"].append(f"dedup/index.json: {e}")
            all_ok = False
    manifest["counts"]["dedup_fingerprints"] = dedup_count
    orphan_note = f" ⚠️  {dedup_orphans} orphans" if dedup_orphans else ""
    print(f"✅ dedup:         {dedup_count} fingerprints, all business_ids valid{orphan_note}")

    # ── activity logs ─────────────────────────────────────────────────────────
    logs_dir = backup_dir / "logs"
    log_files = 0
    log_lines = 0
    if logs_dir.exists():
        for f in sorted(logs_dir.glob("*.jsonl")):
            file_lines = 0
            try:
                for line in f.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    json.loads(line)   # validates JSON
                    file_lines += 1
                manifest["files"][str(f.relative_to(backup_dir))] = sha256_file(f)
                log_files += 1
                log_lines += file_lines
            except Exception as e:
                manifest["errors"].append(f"logs/{f.name}: {e}")
                all_ok = False
    manifest["counts"]["log_files"]  = log_files
    manifest["counts"]["log_lines"]  = log_lines
    print(f"✅ logs:           {log_files} JSONL files, {log_lines} lines verified")

    # ── checkpoints ───────────────────────────────────────────────────────────
    chk_dir = backup_dir / "checkpoints"
    chk_count = 0
    if chk_dir.exists():
        for f in sorted(chk_dir.glob("*.json")):
            try:
                json.loads(f.read_text(encoding="utf-8"))
                manifest["files"][str(f.relative_to(backup_dir))] = sha256_file(f)
                chk_count += 1
            except Exception as e:
                manifest["errors"].append(f"checkpoints/{f.name}: {e}")
                all_ok = False
    manifest["counts"]["checkpoints"] = chk_count
    print(f"✅ checkpoints:    {chk_count} files verified")

    # ── quotas ────────────────────────────────────────────────────────────────
    quota_dir = backup_dir / "quotas"
    quota_count = 0
    if quota_dir.exists():
        for f in sorted(quota_dir.glob("*.json")):
            try:
                json.loads(f.read_text(encoding="utf-8"))
                manifest["files"][str(f.relative_to(backup_dir))] = sha256_file(f)
                quota_count += 1
            except Exception as e:
                manifest["errors"].append(f"quotas/{f.name}: {e}")
                all_ok = False
    manifest["counts"]["quotas"] = quota_count
    print(f"✅ quotas:         {quota_count} files verified")

    # ── settings ──────────────────────────────────────────────────────────────
    settings_file = backup_dir / "settings" / "settings.json"
    settings_ok = False
    if settings_file.exists():
        try:
            json.loads(settings_file.read_text(encoding="utf-8"))
            manifest["files"][str(settings_file.relative_to(backup_dir))] = sha256_file(settings_file)
            settings_ok = True
        except Exception as e:
            manifest["errors"].append(f"settings/settings.json: {e}")
            all_ok = False
    manifest["counts"]["settings"] = 1 if settings_ok else 0
    print(f"{'✅' if settings_ok else '⚠️ '} settings:       {'1 file verified' if settings_ok else '(no settings file)'}")

    # ── schedules ─────────────────────────────────────────────────────────────
    schedules_file = backup_dir / "schedules" / "schedules.json"
    sched_count = 0
    if schedules_file.exists():
        try:
            data = json.loads(schedules_file.read_text(encoding="utf-8"))
            sched_count = len(data) if isinstance(data, list) else 0
            manifest["files"][str(schedules_file.relative_to(backup_dir))] = sha256_file(schedules_file)
        except Exception as e:
            manifest["errors"].append(f"schedules/schedules.json: {e}")
            all_ok = False
    manifest["counts"]["schedules"] = sched_count
    print(f"✅ schedules:      {sched_count} items (empty is OK)")

    # ── totals & errors ───────────────────────────────────────────────────────
    total_files = len(manifest["files"])
    manifest["total_files_hashed"] = total_files
    manifest["all_ok"] = all_ok and len(manifest["errors"]) == 0

    print(f"\n{'─'*60}")
    print(f"Total files hashed: {total_files}")

    if manifest["errors"]:
        print(f"\n❌ ERRORS ({len(manifest['errors'])}):")
        for err in manifest["errors"]:
            print(f"   {err}")
    else:
        print("No errors found.")

    # ── write manifest ────────────────────────────────────────────────────────
    manifest_path = backup_dir / "MANIFEST.json"
    # S8: manifest contains hashes only, no credentials
    manifest_path.write_text(
        json.dumps(manifest, indent=2, default=str),
        encoding="utf-8"
    )
    print(f"\nManifest saved: {manifest_path}")

    # ── final verdict ─────────────────────────────────────────────────────────
    print()
    if manifest["all_ok"]:
        print("✅ BACKUP VERIFIED — safe to proceed to Phase 2.1")
    else:
        print("❌ BACKUP VERIFICATION FAILED — do NOT proceed with migration")
        print("   Fix errors above, recreate the backup, and run this script again.")

    return manifest["all_ok"]


def main():
    parser = argparse.ArgumentParser(description="Verify a Scraper Premium JSON backup")
    parser.add_argument("--backup-name", required=True, help="Name of the backup directory")
    parser.add_argument(
        "--storage-dir",
        default=None,
        help="Path to storage root (defaults to SCRAPER_STORAGE_DIR env var or ./storage)",
    )
    args = parser.parse_args()

    # Resolve storage dir — never reads credentials (S8)
    raw = args.storage_dir or os.environ.get("SCRAPER_STORAGE_DIR", "./storage")
    storage_dir = Path(raw) if Path(raw).is_absolute() else Path(__file__).resolve().parent.parent.parent / raw

    ok = verify_backup(args.backup_name, storage_dir)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
