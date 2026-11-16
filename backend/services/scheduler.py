"""
Cron-based schedule executor.

Runs as a daemon thread inside Flask.
Every 60 seconds it:
  1. Loads all enabled schedules
  2. Parses the cron expression
  3. Checks if the schedule is due (next_run <= now)
  4. Creates a job from the schedule's config
  5. Updates next_run and last_run

Cron format: "minute hour day-of-month month day-of-week"
  e.g. "0 6 * * *"  = every day at 06:00 UTC
       "*/30 * * * *" = every 30 minutes
       "0 9 * * 1"  = every Monday at 09:00 UTC
"""

import threading
import time
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from .storage import load_schedules, save_schedules, append_activity
from .jobs import create_job

logger = logging.getLogger(__name__)

_stop_event = threading.Event()
_thread: Optional[threading.Thread] = None


# ── Minimal cron parser ───────────────────────────────────────────────────────

def _field_matches(value: int, field: str, min_val: int, max_val: int) -> bool:
    """Check if a cron field matches the given value."""
    if field == "*":
        return True
    parts = field.split(",")
    for part in parts:
        if "/" in part:
            base, step = part.split("/", 1)
            step = int(step)
            if base == "*":
                start = min_val
            else:
                start = int(base.split("-")[0])
            if value >= start and (value - start) % step == 0:
                return True
        elif "-" in part:
            lo, hi = part.split("-", 1)
            if int(lo) <= value <= int(hi):
                return True
        else:
            if int(part) == value:
                return True
    return False


def cron_matches(cron: str, dt: datetime) -> bool:
    """Return True if the datetime matches the cron expression."""
    try:
        parts = cron.strip().split()
        if len(parts) != 5:
            return False
        minute, hour, dom, month, dow = parts
        return (
            _field_matches(dt.minute,   minute, 0, 59) and
            _field_matches(dt.hour,     hour,   0, 23) and
            _field_matches(dt.day,      dom,    1, 31) and
            _field_matches(dt.month,    month,  1, 12) and
            _field_matches(dt.weekday() + 1 if dt.weekday() < 6 else 0, dow, 0, 6)
        )
    except Exception:
        return False


def next_cron_run(cron: str, after: datetime) -> Optional[datetime]:
    """
    Calculate the next run time for a cron expression after `after`.
    Scans forward minute by minute for up to 1 year.
    """
    # Round up to the next minute
    dt = after.replace(second=0, microsecond=0) + timedelta(minutes=1)
    limit = after + timedelta(days=366)
    while dt <= limit:
        if cron_matches(cron, dt):
            return dt
        dt += timedelta(minutes=1)
    return None


# ── Executor loop ─────────────────────────────────────────────────────────────

def _run_loop():
    logger.info("Schedule executor started")
    while not _stop_event.is_set():
        try:
            _tick()
        except Exception as e:
            logger.error(f"Scheduler tick error: {e}")
        # Sleep 60 seconds (wake up each full minute)
        _stop_event.wait(timeout=60)
    logger.info("Schedule executor stopped")


def _tick():
    now    = datetime.now(timezone.utc)
    # Round down to the current minute for clean comparison
    now_min = now.replace(second=0, microsecond=0)

    schedules = load_schedules()
    changed   = False

    for sched in schedules:
        if not sched.get("enabled", False):
            continue

        cron = sched.get("cron", "")
        if not cron:
            continue

        # Determine if due
        next_run_str = sched.get("next_run")
        if next_run_str:
            try:
                next_run = datetime.fromisoformat(next_run_str)
                if next_run.tzinfo is None:
                    next_run = next_run.replace(tzinfo=timezone.utc)
                due = next_run <= now
            except ValueError:
                due = cron_matches(cron, now_min)
        else:
            # No next_run set yet — fire if the current minute matches
            due = cron_matches(cron, now_min)

        if not due:
            continue

        # Fire the job
        config = sched.get("config") or {}
        try:
            job = create_job({
                **config,
                "triggered_by": f"schedule:{sched['id']}",
                "schedule_name": sched.get("name", ""),
            })
            logger.info(f"Schedule '{sched['name']}' fired → job {job['id']}")

            # Log to a pseudo job-id for the schedule itself
            append_activity(
                job["id"],
                "schedule_triggered",
                f"Triggered by schedule '{sched['name']}' (cron: {cron})",
            )
        except Exception as e:
            logger.error(f"Schedule '{sched['name']}' failed to create job: {e}")

        # Update schedule metadata
        sched["last_run"]  = now.isoformat()
        sched["run_count"] = sched.get("run_count", 0) + 1

        # Calculate and store next_run
        nxt = next_cron_run(cron, now)
        sched["next_run"] = nxt.isoformat() if nxt else None

        changed = True
        logger.info(f"Schedule '{sched['name']}' next run: {sched['next_run']}")

    if changed:
        save_schedules(schedules)


# ── Public API ────────────────────────────────────────────────────────────────

def start_scheduler():
    """Start the background scheduler thread. Call once from app factory."""
    global _thread
    if _thread and _thread.is_alive():
        return  # already running
    _stop_event.clear()
    _thread = threading.Thread(target=_run_loop, daemon=True, name="ScheduleExecutor")
    _thread.start()
    logger.info("Schedule executor daemon thread started")


def stop_scheduler():
    """Gracefully stop the scheduler (used in tests)."""
    _stop_event.set()
    if _thread:
        _thread.join(timeout=5)
