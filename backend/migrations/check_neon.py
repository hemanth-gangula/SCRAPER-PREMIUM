"""Check current Neon state."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
os.chdir(os.path.dirname(os.path.dirname(__file__)))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), '.env'))
import psycopg2

url = os.environ.get('DATABASE_URL', '')
conn = psycopg2.connect(url)
conn.autocommit = True
cur = conn.cursor()

tables = ['jobs','businesses','dedup_fingerprints','activity_logs','checkpoints','quotas','settings','schedules']
print("=== NEON TABLE COUNTS ===")
for t in tables:
    cur.execute(f'SELECT COUNT(*) FROM {t}')
    print(f'  {t:<25} {cur.fetchone()[0]}')

# Diagnose activity_logs issue - check a raw log event
print("\n=== DIAGNOSING ACTIVITY LOGS ===")
import json, pathlib
storage = pathlib.Path(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))) / 'storage'
log_dir = storage / 'logs'
for f in list(log_dir.glob('*.jsonl'))[:1]:
    for line in f.read_text(encoding='utf-8').splitlines()[:2]:
        if line.strip():
            ev = json.loads(line)
            print(f"  Sample event: id={ev.get('id','MISSING')} job_id={ev.get('job_id','MISSING')} ts_field={list(ev.keys())}")

conn.close()
print("\nDone.")
