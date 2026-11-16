"""Data quality / completeness scoring."""

FIELDS_WITH_WEIGHTS = {
    "name":          20,
    "category":       8,
    "street_address": 8,
    "city":           6,
    "postal_code":    6,
    "country":        4,
    "phone":         15,
    "email":         10,
    "website":       10,
    "rating":         5,
    "review_count":   4,
    "latitude":       2,
    "longitude":      2,
}
MAX_SCORE = sum(FIELDS_WITH_WEIGHTS.values())  # 100


def score(record: dict) -> float:
    """Return a 0–100 completeness score."""
    total = 0
    for field, weight in FIELDS_WITH_WEIGHTS.items():
        val = record.get(field)
        if val not in (None, "", 0, "0"):
            total += weight
    return round((total / MAX_SCORE) * 100, 1)


def missing_fields(record: dict) -> list[str]:
    return [f for f in FIELDS_WITH_WEIGHTS if not record.get(f)]


def annotate(record: dict) -> dict:
    record["quality_score"] = score(record)
    record["missing_fields"] = missing_fields(record)
    return record
