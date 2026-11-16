"""Daily quota enforcement — persisted to storage/quotas/YYYY-MM-DD.json."""

from datetime import datetime, timezone
from .storage import get_quota, increment_quota


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def get_today(limit: int) -> dict:
    return get_quota(_today(), limit)


def consume(count: int = 1, limit: int = 500) -> dict:
    return increment_quota(_today(), count, limit=limit)


def can_save(limit: int) -> bool:
    q = get_today(limit)
    return q["used"] < q["limit"]


def remaining(limit: int) -> int:
    q = get_today(limit)
    return max(q["limit"] - q["used"], 0)
