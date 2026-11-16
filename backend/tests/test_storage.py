"""Tests for atomic JSON storage."""

import os
import pytest
from services.storage import (
    save_business, get_business, update_business, count_businesses,
    save_job, get_job, update_job,
    get_quota, increment_quota,
    save_checkpoint, load_checkpoint,
    append_activity, read_activity,
)


def test_business_save_and_get():
    rec = {"name": "Test Cafe", "city": "New York", "phone": "+12125550001"}
    biz_id = save_business(rec)
    assert biz_id
    fetched = get_business(biz_id)
    assert fetched["name"] == "Test Cafe"
    assert fetched["id"] == biz_id


def test_business_update():
    biz_id = save_business({"name": "Old Name"})
    updated = update_business(biz_id, {"name": "New Name", "email": "new@example.com"})
    assert updated["name"] == "New Name"
    assert updated["email"] == "new@example.com"


def test_business_count():
    initial = count_businesses()
    save_business({"name": "Counter Test 1"})
    save_business({"name": "Counter Test 2"})
    assert count_businesses() >= initial + 2


def test_job_lifecycle():
    job = {"id": "test-job-001", "status": "queued", "records_saved": 0, "dupes_skipped": 0}
    save_job(job)
    fetched = get_job("test-job-001")
    assert fetched["status"] == "queued"
    updated = update_job("test-job-001", {"status": "running", "records_saved": 5})
    assert updated["status"] == "running"
    assert updated["records_saved"] == 5


def test_quota_tracking(tmp_path, monkeypatch):
    """Each quota test gets its own isolated storage dir."""
    monkeypatch.setenv("SCRAPER_STORAGE_DIR", str(tmp_path))
    # Use a date that can't conflict with anything
    q1 = get_quota("2099-11-11", 100)
    assert q1["limit"] == 100
    assert q1["used"] == 0
    q2 = increment_quota("2099-11-11", 3)
    assert q2["used"] == 3
    assert q2["remaining"] == 97
    q3 = increment_quota("2099-11-11", 200)
    assert q3["exhausted"] is True


def test_checkpoint_save_and_load():
    save_checkpoint("cp-job-001", {"last_index": 42, "source": "google_maps"})
    loaded = load_checkpoint("cp-job-001")
    assert loaded["last_index"] == 42
    assert "checkpoint_at" in loaded


def test_activity_log():
    append_activity("log-job-001", "job_created", "Test job created")
    append_activity("log-job-001", "record_saved", "Saved: Test Biz")
    events = read_activity("log-job-001")
    assert len(events) >= 2
    assert events[0]["event_type"] == "job_created"


def test_atomic_write_recovery(tmp_path, monkeypatch):
    """Simulate a leftover .tmp file and verify it's cleaned up."""
    monkeypatch.setenv("SCRAPER_STORAGE_DIR", str(tmp_path))
    from services.storage import business_path, _recover_tmp
    biz_id = "orphan-test"
    p = business_path(biz_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    # Create orphaned .tmp
    tmp = p.with_suffix(".tmp")
    tmp.write_text('{"partial": true}')
    assert tmp.exists()
    _recover_tmp(p)
    assert not tmp.exists()
