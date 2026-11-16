"""
db.py — PostgreSQL connection pool for Scraper Premium.

Reads DATABASE_URL from environment only (S8 — never from arguments or code).
Uses a simple thread-safe connection pool built on psycopg2.

Only imported when STORAGE_BACKEND=postgres or NEON_SHADOW_WRITES=true.
When JSON is active this module is never imported.
"""

import os
import threading
from contextlib import contextmanager
from typing import Optional

_pool: Optional[list] = None
_pool_lock = threading.Lock()
_MAX_CONNECTIONS = 5


def _get_db_url() -> str:
    """Read DATABASE_URL from environment only. Never from args. (S8)"""
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError(
            "DATABASE_URL is not set in environment. "
            "Add it to .env — never pass it as an argument."
        )
    return url


def _init_pool() -> None:
    """Initialise the connection pool (lazy, called once)."""
    global _pool
    import psycopg2
    import psycopg2.extras

    url = _get_db_url()
    _pool = []
    for _ in range(_MAX_CONNECTIONS):
        conn = psycopg2.connect(url)
        conn.autocommit = False
        _pool.append(conn)


def _get_connection():
    """Borrow a connection from the pool (blocks if all in use)."""
    global _pool
    with _pool_lock:
        if _pool is None:
            _init_pool()
        while not _pool:
            # All connections in use — wait briefly and retry
            import time
            time.sleep(0.01)
        return _pool.pop()


def _return_connection(conn) -> None:
    """Return a connection to the pool."""
    with _pool_lock:
        if _pool is not None:
            # Reset the connection state before returning
            try:
                if conn.closed == 0:
                    conn.rollback()
                    _pool.append(conn)
                    return
            except Exception:
                pass
            # Connection is broken — replace it
            try:
                conn.close()
            except Exception:
                pass
            import psycopg2
            try:
                new_conn = psycopg2.connect(_get_db_url())
                new_conn.autocommit = False
                _pool.append(new_conn)
            except Exception:
                pass  # pool will shrink — acceptable


@contextmanager
def get_db():
    """
    Context manager that borrows a connection and auto-commits or rolls back.

    Usage:
        from services.db import get_db
        with get_db() as (conn, cur):
            cur.execute("SELECT ...")
            results = cur.fetchall()
        # auto-committed on exit, rolled back on exception
    """
    conn = _get_connection()
    cur = conn.cursor()
    try:
        yield conn, cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        _return_connection(conn)


def close_pool() -> None:
    """Close all connections (call on app shutdown)."""
    global _pool
    with _pool_lock:
        if _pool:
            for conn in _pool:
                try:
                    conn.close()
                except Exception:
                    pass
            _pool = []


def is_available() -> bool:
    """Return True if DATABASE_URL is set and psycopg2 is installed."""
    if not os.environ.get("DATABASE_URL"):
        return False
    try:
        import psycopg2  # noqa: F401
        return True
    except ImportError:
        return False
