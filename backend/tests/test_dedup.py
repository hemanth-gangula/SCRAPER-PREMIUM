"""Tests for global deduplication."""

import os
import pytest
import services.dedup as dedup_mod


@pytest.fixture(autouse=True)
def reset_dedup_index(tmp_path, monkeypatch):
    """Isolate each dedup test: fresh storage dir + cleared in-memory index."""
    monkeypatch.setenv("SCRAPER_STORAGE_DIR", str(tmp_path))
    # Reset in-memory cache so _ensure_index reloads from the fresh dir
    dedup_mod._index = None
    yield
    dedup_mod._index = None


def test_new_record_is_not_duplicate():
    record = {"name": "Unique Cafe", "phone": "+12125559001", "city": "NYC"}
    result = dedup_mod.check(record)
    assert result.is_new


def test_phone_duplicate_detected():
    rec1 = {"name": "Pizza A", "phone": "+12125559002", "city": "NYC", "postal_code": "10001"}
    rec2 = {"name": "Pizza B", "phone": "+12125559002", "city": "Brooklyn"}
    dedup_mod.register(rec1, "biz-001")
    result = dedup_mod.check(rec2)
    assert result.is_duplicate
    assert result.match_tier == "phone"
    assert result.existing_id == "biz-001"


def test_domain_duplicate_detected():
    rec1 = {"name": "Co A", "website": "https://www.example-biz.com"}
    rec2 = {"name": "Co B", "website": "http://example-biz.com/about"}
    dedup_mod.register(rec1, "biz-002")
    result = dedup_mod.check(rec2)
    assert result.is_duplicate
    assert result.match_tier == "domain"


def test_place_id_duplicate():
    rec1 = {"name": "Hotel A", "place_id": "ChIJXXXXXXXXXXX"}
    rec2 = {"name": "Hotel A v2", "place_id": "ChIJXXXXXXXXXXX"}
    dedup_mod.register(rec1, "biz-003")
    result = dedup_mod.check(rec2)
    assert result.is_duplicate
    assert result.match_tier == "place_id"


def test_name_address_fallback():
    rec1 = {"name": "Joe's Pizza LLC", "city": "New York", "postal_code": "10001"}
    rec2 = {"name": "Joes Pizza", "city": "New York", "postal_code": "10001"}
    dedup_mod.register(rec1, "biz-004")
    result = dedup_mod.check(rec2)
    assert result.is_duplicate
    assert result.match_tier == "name_addr"


def test_same_name_different_city_is_not_duplicate():
    rec1 = {"name": "Best Burger", "city": "New York", "postal_code": "10001"}
    rec2 = {"name": "Best Burger", "city": "Los Angeles", "postal_code": "90001"}
    dedup_mod.register(rec1, "biz-005")
    result = dedup_mod.check(rec2)
    assert result.is_new  # different location — different business


def test_duplicate_does_not_inflate_unique_count():
    rec = {"name": "Single Biz", "phone": "+12125559099", "city": "NYC", "postal_code": "10001"}
    dedup_mod.register(rec, "biz-006")
    # Same record again
    result = dedup_mod.check(rec)
    assert result.is_duplicate
    # Still only 1 entry in index for this tier
    idx = dedup_mod._index
    assert idx.get("phone:2125559099") == "biz-006"


def test_phone_normalization():
    assert dedup_mod._norm_phone("+1 (212) 555-9010") == "2125559010"
    assert dedup_mod._norm_phone("212-555-9010") == "2125559010"
    assert dedup_mod._norm_phone("") is None
    assert dedup_mod._norm_phone("123") is None  # too short


def test_domain_normalization():
    assert dedup_mod._norm_domain("https://www.example.com/path") == "example.com"
    assert dedup_mod._norm_domain("http://Example.COM") == "example.com"
    assert dedup_mod._norm_domain("") is None
