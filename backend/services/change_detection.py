"""
Change detection — when a known business is encountered again,
compare field values and record what changed.
"""

from datetime import datetime, timezone
from .storage import get_business, update_business, append_activity

# Fields we consider authoritative for change detection
TRACKED_FIELDS = [
    "name", "category", "phone", "email", "website",
    "street_address", "city", "state_region", "postal_code",
    "rating", "review_count", "opening_status",
]


def detect_and_merge(existing_id: str, new_data: dict, job_id: str) -> dict:
    """
    Compare new_data against the existing record.
    Merge improvements, preserve originals, log changes.
    Returns the (potentially updated) record.
    """
    existing = get_business(existing_id)
    if not existing:
        return new_data

    changes = {}
    for field in TRACKED_FIELDS:
        old_val = existing.get(field)
        new_val = new_data.get(field)
        if new_val and new_val != old_val:
            # Only overwrite if new value is non-empty and different
            changes[field] = {"old": old_val, "new": new_val}

    if changes:
        updates = {f: v["new"] for f, v in changes.items()}
        updates["change_history"] = existing.get("change_history", []) + [{
            "job_id":     job_id,
            "detected_at": datetime.now(timezone.utc).isoformat(),
            "changes":    changes,
        }]
        updates["has_changes"] = True
        updated = update_business(existing_id, updates)
        append_activity(
            job_id, "change_detected",
            f"Changes detected for '{existing.get('name')}': {list(changes.keys())}",
            {"business_id": existing_id, "fields": list(changes.keys())}
        )
        return updated or existing
    return existing
