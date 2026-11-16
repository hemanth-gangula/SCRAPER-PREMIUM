"""API endpoint tests."""

import pytest
import json


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    data = r.get_json()
    assert "status" in data
    assert data["status"] in ("ok", "degraded")


def test_dashboard(client):
    r = client.get("/api/dashboard")
    assert r.status_code == 200
    data = r.get_json()
    assert "total_businesses" in data
    assert "total_jobs" in data
    assert isinstance(data["total_businesses"], int)


def test_create_job_validation(client):
    # Missing both search_query and category
    r = client.post("/api/jobs", json={"start_index": 1, "end_index": 10})
    assert r.status_code == 400
    data = r.get_json()
    assert "details" in data


def test_create_job_invalid_range(client):
    r = client.post("/api/jobs", json={
        "search_query": "test",
        "start_index": 50,
        "end_index": 10
    })
    assert r.status_code == 400


def test_create_job_success(client):
    r = client.post("/api/jobs", json={
        "search_query": "restaurants",
        "city": "New York",
        "country": "United States",
        "start_index": 1,
        "end_index": 20,
        "daily_limit": 100,
        "job_limit": 50,
    })
    assert r.status_code == 201
    data = r.get_json()
    assert "id" in data
    assert data["status"] == "queued"


def test_get_job(client):
    # Create one first
    r = client.post("/api/jobs", json={
        "search_query": "hotels",
        "start_index": 1, "end_index": 5
    })
    job_id = r.get_json()["id"]
    r2 = client.get(f"/api/jobs/{job_id}")
    assert r2.status_code == 200
    data = r2.get_json()
    assert data["id"] == job_id


def test_get_nonexistent_job(client):
    r = client.get("/api/jobs/does-not-exist")
    assert r.status_code == 404


def test_list_businesses_empty(client):
    r = client.get("/api/businesses")
    assert r.status_code == 200
    data = r.get_json()
    assert "items" in data
    assert "total" in data
    assert isinstance(data["items"], list)


def test_export_csv_empty(client):
    r = client.get("/api/exports/csv")
    assert r.status_code == 200
    assert "text/csv" in r.content_type


def test_export_xlsx_empty(client):
    r = client.get("/api/exports/xlsx")
    assert r.status_code == 200
    # XLSX is a zip file — check PK magic bytes
    assert r.data[:2] == b"PK"


def test_export_json_empty(client):
    r = client.get("/api/exports/json")
    assert r.status_code == 200
    parsed = json.loads(r.data)
    assert isinstance(parsed, list)


def test_settings_get_and_update(client):
    r = client.get("/api/settings")
    assert r.status_code == 200

    r2 = client.put("/api/settings",
                    json={"default_daily_limit": "300"},
                    content_type="application/json")
    assert r2.status_code == 200
    data = r2.get_json()
    assert "default_daily_limit" in data["updated"]


def test_schedules_crud(client):
    # Create
    r = client.post("/api/schedules", json={"name": "Daily Scan", "cron": "0 6 * * *"})
    assert r.status_code == 201
    sid = r.get_json()["id"]

    # List
    r2 = client.get("/api/schedules")
    assert r2.status_code == 200
    ids = [s["id"] for s in r2.get_json()]
    assert sid in ids

    # Delete
    r3 = client.delete(f"/api/schedules/{sid}")
    assert r3.status_code == 200


def test_quota_enforcement(client):
    """Test that daily quota is tracked via storage."""
    from services.quota import get_today, consume
    q = get_today(10)
    initial_used = q["used"]
    consume(3)
    q2 = get_today(10)
    assert q2["used"] == initial_used + 3


def test_job_cancel(client):
    r = client.post("/api/jobs", json={"search_query": "test", "start_index": 1, "end_index": 5})
    job_id = r.get_json()["id"]
    r2 = client.post(f"/api/jobs/{job_id}/cancel")
    assert r2.status_code == 200
    assert r2.get_json()["status"] == "cancelled"
