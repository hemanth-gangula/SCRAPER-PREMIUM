"""
verify_migration.py — Phase 2.4 post-migration integrity checker.

Compares JSON storage counts against Neon PostgreSQL row counts.
Checks dedup integrity, orphan records, email separation, and spot-checks
3 random businesses for field-level match.

Safeguards: S2 (read-only on JSON), S3 (detailed report), S8 (no credentials in output).

Usage:
    python verify_migration.py
    python verify_migration.py --storage-dir /data/storage
"""

import argparse
import json
import os
import random
import sys
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


# ── JSON counts (read-only, S2) ───────────────────────────────────────────────

def json_counts(storage: Path) -> dict:
    biz = sum(1 for s in (storage / "businesses").iterdir() if s.is_dir()
              for _ in s.glob("*.json")) if (storage / "businesses").exists() else 0
    jobs = len(list((storage / "jobs").glob("*.json"))) if (storage / "jobs").exists() else 0
    dedup_file = storage / "deduplication" / "index.json"
    dedup = len(json.loads(dedup_file.read_text())) if dedup_file.exists() else 0
    logs = sum(
        sum(1 for l in f.read_text().splitlines() if l.strip())
        for f in (storage / "logs").glob("*.jsonl")
    ) if (storage / "logs").exists() else 0
    chk = len(list((storage / "checkpoints").glob("*.json"))) if (storage / "checkpoints").exists() else 0
    quotas = len(list((storage / "quotas").glob("*.json"))) if (storage / "quotas").exists() else 0
    sf = storage / "settings" / "settings.json"
    settings = len(json.loads(sf.read_text())) if sf.exists() else 0
    schf = storage / "schedules" / "schedules.json"
    schedules = len(json.loads(schf.read_text())) if schf.exists() and schf.stat().st_size > 2 else 0
    return {
        "businesses": biz, "jobs": jobs, "dedup_fingerprints": dedup,
        "activity_log_lines": logs, "checkpoints": chk,
        "quotas": quotas, "settings_keys": settings, "schedules": schedules,
    }


def json_all_businesses(storage: Path) -> dict:
    """Return {id: record} for spot-check comparison."""
    result = {}
    biz_dir = storage / "businesses"
    if not biz_dir.exists():
        return result
    for shard in biz_dir.iterdir():
        if not shard.is_dir():
            continue
        for f in shard.glob("*.json"):
            try:
                rec = json.loads(f.read_text(encoding="utf-8"))
                result[rec["id"]] = rec
            except Exception:
                pass
    return result


def json_dedup_index(storage: Path) -> dict:
    idx_file = storage / "deduplication" / "index.json"
    if not idx_file.exists():
        return {}
    return json.loads(idx_file.read_text(encoding="utf-8"))


# ── Neon checks ───────────────────────────────────────────────────────────────

def verify(storage: Path, db_url: str | None) -> bool:
    counts_json = json_counts(storage)

    print("\n" + "=" * 60)
    print("POST-MIGRATION VERIFICATION")
    print("=" * 60)
    print(f"\nJSON storage: {storage}")
    print(f"Neon target:  {'configured' if db_url else 'NOT CONFIGURED'}\n")

    if not db_url:
        print("⚠️  DATABASE_URL not set — skipping live Neon checks.")
        print("   JSON counts (for reference):")
        for k, v in counts_json.items():
            print(f"     {k:<28} {v}")
        print("\nSKIPPED (no DATABASE_URL) — not a failure")
        return True

    try:
        import psycopg2
    except ImportError:
        print("❌ psycopg2 not installed. Run: pip install psycopg2-binary==2.9.9")
        return False

    all_pass = True
    results = []

    try:
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()

        # ── Row count checks ─────────────────────────────────────────────────
        checks = [
            ("businesses",         "SELECT COUNT(*) FROM businesses"),
            ("jobs",               "SELECT COUNT(*) FROM jobs"),
            ("dedup_fingerprints", "SELECT COUNT(*) FROM dedup_fingerprints"),
            ("activity_log_lines", "SELECT COUNT(*) FROM activity_logs"),
            ("checkpoints",        "SELECT COUNT(*) FROM checkpoints"),
            ("quotas",             "SELECT COUNT(*) FROM quotas"),
            ("settings_keys",      "SELECT COUNT(*) FROM settings"),
            ("schedules",          "SELECT COUNT(*) FROM schedules"),
        ]

        print("── Row Count Checks ─────────────────────────────────────────")
        for entity, sql in checks:
            cur.execute(sql)
            pg_count = cur.fetchone()[0]
            json_count = counts_json.get(entity, 0)
            match = pg_count == json_count
            status = "✅" if match else "❌"
            print(f"  {status} {entity:<28} JSON={json_count:>6}  PG={pg_count:>6}{'  ← MISMATCH' if not match else ''}")
            results.append({"entity": entity, "json": json_count, "pg": pg_count, "match": match})
            if not match:
                all_pass = False

        # ── Dedup integrity: no orphan fingerprints ───────────────────────────
        print("\n── Dedup Integrity ──────────────────────────────────────────")
        cur.execute("""
            SELECT COUNT(*) FROM dedup_fingerprints df
            WHERE NOT EXISTS (SELECT 1 FROM businesses b WHERE b.id = df.business_id)
        """)
        orphans = cur.fetchone()[0]
        status = "✅" if orphans == 0 else "❌"
        print(f"  {status} Orphan dedup fingerprints: {orphans}  (expected 0)")
        if orphans > 0:
            all_pass = False

        # ── Business → Job integrity: no orphan businesses ────────────────────
        print("\n── Business → Job Integrity ──────────────────────────────────")
        cur.execute("""
            SELECT COUNT(*) FROM businesses b
            WHERE b.job_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.id = b.job_id)
        """)
        orphan_biz = cur.fetchone()[0]
        status = "✅" if orphan_biz == 0 else "❌"
        print(f"  {status} Businesses with missing job_id FK: {orphan_biz}  (expected 0)")
        if orphan_biz > 0:
            all_pass = False

        # ── Activity log → Job integrity ──────────────────────────────────────
        print("\n── Activity Log → Job Integrity ─────────────────────────────")
        cur.execute("""
            SELECT COUNT(*) FROM activity_logs al
            WHERE NOT EXISTS (SELECT 1 FROM jobs j WHERE j.id = al.job_id)
        """)
        orphan_logs = cur.fetchone()[0]
        status = "✅" if orphan_logs == 0 else "❌"
        print(f"  {status} Log entries with missing job_id FK: {orphan_logs}  (expected 0)")
        if orphan_logs > 0:
            all_pass = False

        # ── Email separation: email and email_guess never both set to same val ─
        print("\n── Email Separation ─────────────────────────────────────────")
        cur.execute("""
            SELECT COUNT(*) FROM businesses
            WHERE email IS NOT NULL AND email_guess IS NOT NULL
            AND email = email_guess
        """)
        email_conflicts = cur.fetchone()[0]
        status = "✅" if email_conflicts == 0 else "❌"
        print(f"  {status} Businesses with email == email_guess: {email_conflicts}  (expected 0)")
        if email_conflicts > 0:
            all_pass = False

        # ── Spot-check 3 random businesses ────────────────────────────────────
        print("\n── Spot-Check (3 random businesses) ─────────────────────────")
        json_biz = json_all_businesses(storage)
        sample_ids = random.sample(list(json_biz.keys()), min(3, len(json_biz)))
        spot_ok = True
        for biz_id in sample_ids:
            cur.execute("SELECT id, name, phone, email, place_id, quality_score FROM businesses WHERE id = %s", (biz_id,))
            row = cur.fetchone()
            if not row:
                print(f"  ❌ {biz_id[:16]}… NOT FOUND in Neon")
                spot_ok = False
                all_pass = False
                continue
            pg_id, pg_name, pg_phone, pg_email, pg_place, pg_quality = row
            src = json_biz[biz_id]
            name_ok    = pg_name    == src.get("name", "")
            phone_ok   = pg_phone   == src.get("phone")
            email_ok   = pg_email   == src.get("email")
            quality_ok = pg_quality == src.get("quality_score", 0)
            ok = name_ok and phone_ok and email_ok and quality_ok
            status = "✅" if ok else "⚠️ "
            print(f"  {status} {biz_id[:16]}… name={name_ok} phone={phone_ok} email={email_ok} quality={quality_ok}")
            if not ok:
                spot_ok = False
        if not spot_ok:
            all_pass = False

        conn.close()

    except Exception as e:
        print(f"\n❌ Verification failed with exception: {e}")
        all_pass = False

    # ── Final verdict ─────────────────────────────────────────────────────────
    print("\n" + "─" * 60)
    if all_pass:
        print("✅ VERIFICATION PASSED — safe to proceed to Phase 2.5")
    else:
        print("❌ VERIFICATION FAILED — do NOT proceed with cutover")
        print("   Fix the issues above, re-run migration, then run this script again.")

    return all_pass


def main():
    root = Path(__file__).resolve().parent.parent.parent
    load_env(root)

    parser = argparse.ArgumentParser(description="Verify JSON→Neon migration integrity")
    parser.add_argument("--storage-dir", default=None)
    args = parser.parse_args()

    raw = args.storage_dir or os.environ.get("SCRAPER_STORAGE_DIR", "./storage")
    storage = Path(raw) if Path(raw).is_absolute() else root / raw

    db_url = get_db_url()
    ok = verify(storage, db_url)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
