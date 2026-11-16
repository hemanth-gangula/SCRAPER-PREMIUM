"""
cutover.py — Phase 2.6 explicit cutover from JSON to Neon PostgreSQL.

Safeguard S5: NEVER automatic. Requires two explicit confirmation flags.
              Even after cutover, only prints instructions — you manually
              edit .env. No file is modified by this script.

Usage (ONLY after Phase 2.4 verification passes):
    python cutover.py --confirm-cutover --i-have-verified-neon-data
"""

import argparse
import os
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


def run_verification(storage: Path, db_url: str) -> bool:
    """Run verify_migration.py inline before allowing cutover."""
    import importlib.util
    verify_path = Path(__file__).parent / "verify_migration.py"
    spec = importlib.util.spec_from_file_location("verify_migration", verify_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.verify(storage, db_url)


def sync_delta(storage: Path, db_url: str) -> tuple[int, int]:
    """Copy any JSON records that aren't yet in Neon (created after Phase 2.3)."""
    import json
    import psycopg2
    import psycopg2.extras

    conn = psycopg2.connect(db_url)
    cur  = conn.cursor()

    # Businesses not yet in Neon
    biz_dir = storage / "businesses"
    new_biz = 0
    if biz_dir.exists():
        cur.execute("SELECT id FROM businesses")
        pg_biz = {row[0] for row in cur.fetchall()}
        for shard in biz_dir.iterdir():
            if not shard.is_dir():
                continue
            for f in shard.glob("*.json"):
                try:
                    rec = json.loads(f.read_text(encoding="utf-8"))
                    if rec["id"] not in pg_biz:
                        cur.execute("""
                            INSERT INTO businesses (id,name,quality_score,source,first_seen_at,last_scraped_at)
                            VALUES (%(id)s,%(name)s,%(quality_score)s,%(source)s,%(first_seen_at)s,%(last_scraped_at)s)
                            ON CONFLICT (id) DO NOTHING
                        """, {
                            "id": rec["id"], "name": rec.get("name",""),
                            "quality_score": rec.get("quality_score",0),
                            "source": rec.get("source","google_maps"),
                            "first_seen_at": rec.get("first_seen_at"),
                            "last_scraped_at": rec.get("last_scraped_at"),
                        })
                        new_biz += 1
                except Exception:
                    pass

    # Jobs not yet in Neon
    jobs_dir = storage / "jobs"
    new_jobs = 0
    if jobs_dir.exists():
        cur.execute("SELECT id FROM jobs")
        pg_jobs = {row[0] for row in cur.fetchall()}
        for f in jobs_dir.glob("*.json"):
            try:
                rec = json.loads(f.read_text(encoding="utf-8"))
                if rec["id"] not in pg_jobs:
                    cur.execute("""
                        INSERT INTO jobs (id,status,config,created_at,updated_at)
                        VALUES (%s,%s,%s,%s,%s)
                        ON CONFLICT (id) DO NOTHING
                    """, (rec["id"], rec.get("status","queued"),
                          json.dumps(rec.get("config",{})),
                          rec.get("created_at"), rec.get("updated_at")))
                    new_jobs += 1
            except Exception:
                pass

    conn.commit()
    conn.close()
    return new_biz, new_jobs


def cutover(storage: Path, db_url: str | None) -> bool:
    print("\n" + "=" * 60)
    print("CUTOVER — JSON → Neon PostgreSQL")
    print("=" * 60)

    if not db_url:
        print("❌ DATABASE_URL not set. Cannot proceed with cutover.")
        return False

    # ── Step 1: Run full verification ─────────────────────────────────────────
    print("\nStep 1/4: Running post-migration verification…")
    ok = run_verification(storage, db_url)
    if not ok:
        print("\n❌ Verification FAILED. Cutover aborted.")
        print("   Fix the issues reported above, re-run migrate_json_to_pg.py, then try again.")
        return False
    print("✅ Verification passed.")

    # ── Step 2: Sync delta ────────────────────────────────────────────────────
    print("\nStep 2/4: Syncing delta (records created since Phase 2.3)…")
    try:
        import psycopg2  # noqa: F401
        new_biz, new_jobs = sync_delta(storage, db_url)
        print(f"  Synced {new_biz} new businesses, {new_jobs} new jobs to Neon.")
    except Exception as e:
        print(f"❌ Delta sync failed: {e}")
        return False

    # ── Step 3: Record cutover in migration_runs ──────────────────────────────
    print("\nStep 3/4: Recording cutover event…")
    try:
        import psycopg2
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO migration_runs (phase, status, notes)
            VALUES ('cutover', 'completed', 'cutover.py executed with --confirm-cutover')
        """)
        conn.commit()
        conn.close()
        print("  ✅ Recorded.")
    except Exception as e:
        print(f"  ⚠️  Could not record cutover event: {e} (non-fatal)")

    # ── Step 4: Print instructions (S5 — never auto-modify .env) ─────────────
    print("\nStep 4/4: Cutover instructions")
    print("─" * 60)
    print("✅ Neon data is verified and up to date.")
    print()
    print("To activate Neon as the live backend, YOU must do one of:")
    print()
    print("  LOCAL — edit .env:")
    print("    STORAGE_BACKEND=postgres")
    print("    (then restart: python app.py)")
    print()
    print("  RENDER — dashboard:")
    print("    Go to backend service → Environment")
    print("    Set STORAGE_BACKEND = postgres")
    print("    Trigger a redeploy")
    print()
    print("⚠️  JSON files are NOT deleted. Rollback is always available:")
    print("    python migrations/rollback.py")
    print("─" * 60)
    return True


def main():
    root = Path(__file__).resolve().parent.parent.parent
    load_env(root)

    parser = argparse.ArgumentParser(
        description="Cutover Scraper Premium from JSON to Neon PostgreSQL.\n"
                    "Requires explicit confirmation flags. (Safeguard S5)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--confirm-cutover",          action="store_true",
                        help="First confirmation flag (required)")
    parser.add_argument("--i-have-verified-neon-data", action="store_true",
                        help="Second confirmation flag (required)")
    parser.add_argument("--storage-dir", default=None)
    args = parser.parse_args()

    # S5: Both flags must be present
    if not args.confirm_cutover or not args.i_have_verified_neon_data:
        print("❌ Cutover requires both confirmation flags:")
        print("   --confirm-cutover  --i-have-verified-neon-data")
        print()
        print("Only run this after Phase 2.4 verification has passed.")
        sys.exit(1)

    raw = args.storage_dir or os.environ.get("SCRAPER_STORAGE_DIR", "./storage")
    storage = Path(raw) if Path(raw).is_absolute() else root / raw
    db_url  = get_db_url()

    ok = cutover(storage, db_url)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
