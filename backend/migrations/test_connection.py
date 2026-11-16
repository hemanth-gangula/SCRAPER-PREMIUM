"""Test Neon connection. Never prints credentials."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
os.chdir(os.path.dirname(os.path.dirname(__file__)))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), '.env'))

import psycopg2

url = os.environ.get('DATABASE_URL', '')
if not url:
    print('ERROR: DATABASE_URL not set in .env')
    sys.exit(1)

print(f'Connecting to Neon (url length={len(url)})...')
try:
    conn = psycopg2.connect(url)
    cur = conn.cursor()
    cur.execute('SELECT version()')
    version = cur.fetchone()[0]
    pg_version = version.split(',')[0]
    print(f'SUCCESS: {pg_version}')

    cur.execute("""
        SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' ORDER BY table_name
    """)
    tables = [r[0] for r in cur.fetchall()]
    if tables:
        print(f'Existing tables ({len(tables)}): {", ".join(tables)}')
    else:
        print('No tables yet (fresh database)')

    cur.execute('SELECT NOW()')
    ts = cur.fetchone()[0]
    print(f'Server time: {ts}')
    conn.close()
    print('Connection test: PASSED')
except Exception as e:
    print(f'Connection FAILED: {type(e).__name__}: {str(e)[:200]}')
    sys.exit(1)
