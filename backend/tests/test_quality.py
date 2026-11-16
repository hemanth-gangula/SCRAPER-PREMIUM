"""Data quality scoring tests."""

from services.quality import score, missing_fields, annotate


def test_empty_record_scores_zero():
    assert score({}) == 0.0


def test_name_only_scores_20():
    assert score({"name": "Biz"}) == 20.0


def test_full_record_scores_100():
    rec = {
        "name": "Full Biz", "category": "Restaurant",
        "street_address": "123 Main", "city": "NYC",
        "postal_code": "10001", "country": "US",
        "phone": "+12125550001", "email": "biz@example.com",
        "website": "https://example.com", "rating": 4.5,
        "review_count": 100, "latitude": 40.7, "longitude": -74.0,
    }
    assert score(rec) == 100.0


def test_missing_fields_list():
    rec = {"name": "Partial", "phone": "+12125550001"}
    missing = missing_fields(rec)
    assert "email" in missing
    assert "website" in missing
    assert "name" not in missing
    assert "phone" not in missing


def test_annotate_adds_quality_score():
    rec = {"name": "Test", "city": "NYC"}
    annotated = annotate(rec)
    assert "quality_score" in annotated
    assert "missing_fields" in annotated
    assert annotated["quality_score"] > 0
