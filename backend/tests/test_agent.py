"""
Tests for the AI Agent layer.

All tests use MockProvider — no real LLM API key required.

Test classes:
  1. TestMockProvider          — provider interface + state machine behaviour
  2. TestProviderFactory       — factory + auto-detection
  3. TestToolSchemas           — schema validity
  4. TestToolExecutor          — each tool independently
  5. TestSessionState          — session CRUD + persistence
  6. TestAgentLoop             — full turn: tool calls, loop detection, approval gate
  7. TestApprovalWorkflow      — config preview, no premature job creation, approval flow
  8. TestAgentRoutes           — Flask route layer
"""

import json
import time
import pytest

from services.agent.provider import MockProvider, get_provider, list_providers
from services.agent.tools import ToolExecutor, TOOL_SCHEMAS
from services.agent import state as session_state
from services.agent.agent import (
    run_turn, _user_approved, _canonical_args, READ_ONLY_TOOLS, STATE_CHANGING_TOOLS,
)


# ═══════════════════════════════════════════════════════════════════════════
# Fixtures
# ═══════════════════════════════════════════════════════════════════════════

@pytest.fixture
def mock_provider():
    p = MockProvider()
    p.reset()
    return p


@pytest.fixture
def tool_exec():
    return ToolExecutor()


@pytest.fixture
def session(tmp_path, monkeypatch):
    """Fresh session in a temp directory."""
    import services.agent.state as st
    monkeypatch.setattr(st, "SESSIONS_DIR", tmp_path / "agent_sessions")
    s = session_state.create_session(title="Test Session")
    return s


@pytest.fixture
def app_client(app):
    return app.test_client()


# ═══════════════════════════════════════════════════════════════════════════
# 1. MockProvider tests
# ═══════════════════════════════════════════════════════════════════════════

class TestMockProvider:
    def test_basic_chat_no_tools(self, mock_provider):
        resp = mock_provider.chat([{"role": "user", "content": "hello"}])
        assert resp["finish_reason"] == "stop"
        assert resp["content"] is not None

    def test_tool_calls_have_unique_ids(self, mock_provider):
        """Every tool call must have a unique ID — no ID collisions."""
        tools = [{"type": "function", "function": {
            "name": "get_health", "description": "x",
            "parameters": {"type": "object", "properties": {}, "required": []},
        }}]
        ids = set()
        mock_provider.reset()
        # Simulate two separate calls
        for _ in range(3):
            resp = mock_provider.chat(
                [{"role": "user", "content": "check health"}], tools=tools
            )
            if resp.get("tool_calls"):
                for tc in resp["tool_calls"]:
                    assert tc["id"] not in ids, f"Duplicate tool call ID: {tc['id']}"
                    ids.add(tc["id"])
            mock_provider.reset()  # reset state between calls

    def test_scripted_responses_sequential(self, mock_provider):
        script = [
            {"content": "first",  "tool_calls": None, "finish_reason": "stop", "raw": {}},
            {"content": "second", "tool_calls": None, "finish_reason": "stop", "raw": {}},
        ]
        mock_provider.set_script(script)
        r1 = mock_provider.chat([{"role": "user", "content": "1"}])
        r2 = mock_provider.chat([{"role": "user", "content": "2"}])
        assert r1["content"] == "first"
        assert r2["content"] == "second"

    def test_health_check(self, mock_provider):
        result = mock_provider.health_check()
        assert result["ok"] is True
        assert result["provider"] == "mock"

    def test_name_model(self, mock_provider):
        assert mock_provider.name == "mock"
        assert mock_provider.model == "mock-model-v1"

    def test_reset_clears_state(self, mock_provider):
        mock_provider._state = "job_created"
        mock_provider._pending_config = {"search_query": "test"}
        mock_provider.reset()
        assert mock_provider._state == "idle"
        assert mock_provider._pending_config is None

    # ── Restaurant request scenario ─────────────────────────────────────────

    def test_restaurant_request_first_call_searches_businesses(self, mock_provider):
        """First call for a restaurant request must call search_businesses (READ-ONLY)."""
        tools = TOOL_SCHEMAS
        resp = mock_provider.chat(
            [{"role": "user", "content": "Find 5 restaurants in New York, ZIP 10001"}],
            tools=tools,
        )
        assert resp["finish_reason"] == "tool_calls"
        assert resp["tool_calls"] is not None
        tc = resp["tool_calls"][0]
        assert tc["function"]["name"] == "search_businesses", (
            f"Expected search_businesses, got {tc['function']['name']}"
        )

    def test_restaurant_request_does_not_create_job_on_first_call(self, mock_provider):
        """Must not call create_scraping_job without user approval."""
        resp = mock_provider.chat(
            [{"role": "user", "content": "Find 5 restaurants in New York, ZIP 10001"}],
            tools=TOOL_SCHEMAS,
        )
        if resp.get("tool_calls"):
            names = [tc["function"]["name"] for tc in resp["tool_calls"]]
            assert "create_scraping_job" not in names, (
                "create_scraping_job called before user approval!"
            )

    def test_after_search_result_returns_config_preview(self, mock_provider):
        """After receiving search result, mock must return a text config preview."""
        # Advance state machine to 'searching'
        tools = TOOL_SCHEMAS
        mock_provider.chat(
            [{"role": "user", "content": "Find 5 restaurants in New York, ZIP 10001"}],
            tools=tools,
        )
        assert mock_provider._state == "searching"

        # Now simulate receiving a tool result
        messages = [
            {"role": "user", "content": "Find 5 restaurants in New York, ZIP 10001"},
            {"role": "assistant", "tool_calls": [{"id": "x", "type": "function",
                "function": {"name": "search_businesses", "arguments": "{}"}}]},
            {"role": "tool", "tool_call_id": "x",
             "content": json.dumps({"total": 3, "businesses": []})},
        ]
        resp = mock_provider.chat(messages, tools=tools)
        assert resp["finish_reason"] == "stop"
        assert resp["content"] is not None
        assert "configuration" in resp["content"].lower() or "config" in resp["content"].lower() \
            or "search query" in resp["content"].lower() or "yes" in resp["content"].lower()

    def test_awaiting_approval_no_job_on_non_approval_message(self, mock_provider):
        """In awaiting_approval state, a non-approval message must not create a job."""
        mock_provider._state = "awaiting_approval"
        mock_provider._pending_config = {"search_query": "restaurants NYC"}
        resp = mock_provider.chat(
            [{"role": "user", "content": "what address fields does the output have?"}],
            tools=TOOL_SCHEMAS,
        )
        # Must NOT call create_scraping_job
        if resp.get("tool_calls"):
            names = [tc["function"]["name"] for tc in resp["tool_calls"]]
            assert "create_scraping_job" not in names
        assert resp["finish_reason"] == "stop"

    def test_awaiting_approval_yes_triggers_job_creation(self, mock_provider):
        """'yes' in awaiting_approval state must call create_scraping_job."""
        mock_provider._state = "awaiting_approval"
        mock_provider._pending_config = {
            "search_query": "restaurants in New York 10001",
            "category": "Restaurant",
            "city": "New York",
            "country": "United States",
            "postal_code": "10001",
            "end_index": 5,
            "job_limit": 5,
            "daily_limit": 500,
        }
        resp = mock_provider.chat(
            [{"role": "user", "content": "yes"}],
            tools=TOOL_SCHEMAS,
        )
        assert resp["finish_reason"] == "tool_calls"
        assert resp["tool_calls"] is not None
        names = [tc["function"]["name"] for tc in resp["tool_calls"]]
        assert "create_scraping_job" in names

    def test_all_approval_keywords_work(self, mock_provider):
        """Every approval keyword must trigger job creation."""
        keywords = ["yes", "ok", "okay", "go", "start", "confirmed", "proceed"]
        for kw in keywords:
            mock_provider._state = "awaiting_approval"
            mock_provider._pending_config = {"search_query": "test"}
            resp = mock_provider.chat(
                [{"role": "user", "content": kw}], tools=TOOL_SCHEMAS
            )
            assert resp["finish_reason"] == "tool_calls", (
                f"Keyword '{kw}' did not trigger tool call"
            )
            if resp.get("tool_calls"):
                names = [tc["function"]["name"] for tc in resp["tool_calls"]]
                assert "create_scraping_job" in names, (
                    f"Keyword '{kw}' did not trigger create_scraping_job"
                )


# ═══════════════════════════════════════════════════════════════════════════
# 2. Provider factory tests
# ═══════════════════════════════════════════════════════════════════════════

class TestProviderFactory:
    def test_get_mock_provider(self):
        p = get_provider("mock")
        assert p.name == "mock"

    def test_unknown_provider_raises(self):
        with pytest.raises(ValueError, match="Unknown LLM provider"):
            get_provider("nonexistent_provider_xyz")

    def test_list_providers_returns_all(self):
        providers = list_providers()
        names = {p["name"] for p in providers}
        assert names >= {"groq", "openai", "anthropic", "local", "mock"}

    def test_mock_always_configured(self):
        providers = list_providers()
        mock_info = next(p for p in providers if p["name"] == "mock")
        assert mock_info["configured"] is True

    def test_auto_detect_falls_back_to_mock(self, monkeypatch):
        monkeypatch.delenv("GROQ_API_KEY", raising=False)
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        monkeypatch.delenv("LLM_PROVIDER", raising=False)
        import services.agent.provider as prov_module
        # Also blank out the config singleton's cached GROQ_API_KEY
        monkeypatch.setattr(prov_module.config, "GROQ_API_KEY", "")
        p = get_provider()
        assert p.name == "mock"


# ═══════════════════════════════════════════════════════════════════════════
# 3. Tool schema tests
# ═══════════════════════════════════════════════════════════════════════════

class TestToolSchemas:
    def test_all_tools_have_required_fields(self):
        for t in TOOL_SCHEMAS:
            assert t["type"] == "function"
            fn = t["function"]
            assert "name" in fn
            assert "description" in fn
            assert "parameters" in fn

    def test_tool_count(self):
        assert len(TOOL_SCHEMAS) >= 10

    def test_tool_names_are_unique(self):
        names = [t["function"]["name"] for t in TOOL_SCHEMAS]
        assert len(names) == len(set(names))

    def test_tool_classification_coverage(self):
        """Every tool schema must be in exactly one category."""
        all_tool_names = {t["function"]["name"] for t in TOOL_SCHEMAS}
        classified = READ_ONLY_TOOLS | STATE_CHANGING_TOOLS
        unclassified = all_tool_names - classified
        assert not unclassified, f"Unclassified tools: {unclassified}"

    def test_read_only_and_state_changing_disjoint(self):
        overlap = READ_ONLY_TOOLS & STATE_CHANGING_TOOLS
        assert not overlap, f"Tools in both categories: {overlap}"


# ═══════════════════════════════════════════════════════════════════════════
# 4. Tool executor tests
# ═══════════════════════════════════════════════════════════════════════════

class TestToolExecutor:
    def test_unknown_tool_returns_error(self, tool_exec):
        result = json.loads(tool_exec.execute("nonexistent_tool", {}))
        assert "error" in result

    def test_get_dashboard(self, tool_exec):
        result = json.loads(tool_exec.execute("get_dashboard", {}))
        assert isinstance(result, dict)

    def test_get_health(self, tool_exec):
        result = json.loads(tool_exec.execute("get_health", {}))
        assert isinstance(result, dict)

    def test_list_jobs(self, tool_exec):
        result = json.loads(tool_exec.execute("list_jobs", {"per_page": 5}))
        assert isinstance(result, dict)
        assert "jobs" in result

    def test_search_businesses_no_filters(self, tool_exec):
        result = json.loads(tool_exec.execute("search_businesses", {}))
        assert isinstance(result, dict)
        assert "businesses" in result

    def test_search_businesses_with_city(self, tool_exec):
        result = json.loads(tool_exec.execute("search_businesses", {"city": "New York"}))
        assert isinstance(result, dict)

    def test_search_businesses_per_page_capped(self, tool_exec):
        result = json.loads(tool_exec.execute("search_businesses", {"per_page": 999}))
        assert isinstance(result, dict)

    def test_export_data_invalid_format(self, tool_exec):
        result = json.loads(tool_exec.execute("export_data", {"format": "xml"}))
        assert "error" in result

    def test_export_data_xlsx(self, tool_exec):
        result = json.loads(tool_exec.execute("export_data", {"format": "xlsx"}))
        assert isinstance(result, dict)
        assert "download_url" in result or "error" in result

    def test_export_data_csv(self, tool_exec):
        result = json.loads(tool_exec.execute("export_data", {"format": "csv"}))
        assert isinstance(result, dict)

    def test_export_data_json(self, tool_exec):
        result = json.loads(tool_exec.execute("export_data", {"format": "json"}))
        assert isinstance(result, dict)

    def test_invalid_args_returns_graceful_error(self, tool_exec):
        result = json.loads(tool_exec.execute("get_job_status", {}))
        assert isinstance(result, dict)

    def test_wait_for_job_nonexistent_times_out(self, tool_exec):
        result = json.loads(tool_exec.execute("wait_for_job", {
            "job_id": "nonexistent-job-12345",
            "timeout_seconds": 2,
            "poll_interval": 1,
        }))
        assert isinstance(result, dict)
        assert "status" in result or "error" in result


# ═══════════════════════════════════════════════════════════════════════════
# 5. Session state tests
# ═══════════════════════════════════════════════════════════════════════════

class TestSessionState:
    def test_create_session(self, session):
        assert "id" in session
        assert session["title"] == "Test Session"
        assert session["messages"] == []

    def test_get_session(self, session):
        loaded = session_state.get_session(session["id"])
        assert loaded["id"] == session["id"]

    def test_get_session_not_found(self):
        assert session_state.get_session("nonexistent-xyz") is None

    def test_append_message(self, session):
        updated = session_state.append_message(session["id"], {"role": "user", "content": "hello"})
        assert len(updated["messages"]) == 1

    def test_auto_title_from_first_message(self, tmp_path, monkeypatch):
        import services.agent.state as st
        monkeypatch.setattr(st, "SESSIONS_DIR", tmp_path / "agent_sessions2")
        s = session_state.create_session()   # no title → "New Session"
        session_state.append_message(s["id"], {"role": "user", "content": "Find restaurants in NYC"})
        loaded = session_state.get_session(s["id"])
        assert "Find restaurants in NYC" in loaded["title"]

    def test_auto_title_truncated_at_60(self, tmp_path, monkeypatch):
        import services.agent.state as st
        monkeypatch.setattr(st, "SESSIONS_DIR", tmp_path / "agent_sessions3")
        s = session_state.create_session()
        session_state.append_message(s["id"], {"role": "user", "content": "A" * 100})
        loaded = session_state.get_session(s["id"])
        assert len(loaded["title"]) <= 62

    def test_track_job(self, session):
        session_state.track_job(session["id"], "job-123")
        loaded = session_state.get_session(session["id"])
        assert "job-123" in loaded["job_ids"]

    def test_track_job_no_duplicates(self, session):
        session_state.track_job(session["id"], "job-123")
        session_state.track_job(session["id"], "job-123")
        loaded = session_state.get_session(session["id"])
        assert loaded["job_ids"].count("job-123") == 1

    def test_list_sessions(self, session):
        sessions = session_state.list_sessions()
        assert any(s["id"] == session["id"] for s in sessions)

    def test_list_sessions_no_messages_in_list(self, session):
        session_state.append_message(session["id"], {"role": "user", "content": "hello"})
        sessions = session_state.list_sessions()
        s = next(s for s in sessions if s["id"] == session["id"])
        assert "messages" not in s
        assert s["message_count"] == 1

    def test_update_session(self, session):
        updated = session_state.update_session(session["id"], title="Updated Title")
        assert updated["title"] == "Updated Title"

    def test_delete_session(self, session):
        assert session_state.delete_session(session["id"]) is True
        assert session_state.get_session(session["id"]) is None

    def test_delete_nonexistent(self):
        assert session_state.delete_session("nonexistent-xyz") is False

    def test_atomic_write(self, session):
        for i in range(10):
            session_state.append_message(session["id"], {"role": "user", "content": f"msg {i}"})
        loaded = session_state.get_session(session["id"])
        assert len(loaded["messages"]) == 10


# ═══════════════════════════════════════════════════════════════════════════
# 6. Agent loop tests — tool calls, loop detection, approval gate
# ═══════════════════════════════════════════════════════════════════════════

class TestAgentLoop:

    def test_simple_text_reply(self, session, mock_provider):
        mock_provider.set_script([
            {"content": "Done.", "tool_calls": None, "finish_reason": "stop", "raw": {}},
        ])
        result = run_turn(session["id"], "hello", provider=mock_provider)
        assert result["reply"] == "Done."
        assert result["session_id"] == session["id"]

    def test_session_messages_persisted(self, session, mock_provider):
        mock_provider.set_script([
            {"content": "Hi!", "tool_calls": None, "finish_reason": "stop", "raw": {}},
        ])
        run_turn(session["id"], "Hello", provider=mock_provider)
        loaded = session_state.get_session(session["id"])
        roles = [m["role"] for m in loaded["messages"]]
        assert "user" in roles
        assert "assistant" in roles

    def test_tool_result_fed_back_correctly(self, session, mock_provider):
        """
        LLM calls get_dashboard → receives result → produces text reply.
        Verifies the tool result is correctly propagated into the next LLM call.
        """
        mock_provider.set_script([
            {
                "content": None,
                "tool_calls": [{
                    "id": "tc_001",
                    "type": "function",
                    "function": {"name": "get_dashboard", "arguments": "{}"},
                }],
                "finish_reason": "tool_calls",
                "raw": {},
            },
            {
                "content": "The dashboard shows 34 businesses.",
                "tool_calls": None,
                "finish_reason": "stop",
                "raw": {},
            },
        ])
        result = run_turn(session["id"], "Show me the dashboard", provider=mock_provider)
        assert result["reply"] == "The dashboard shows 34 businesses."
        assert len(result["tool_calls"]) == 1
        assert result["tool_calls"][0]["name"] == "get_dashboard"
        # Verify result was not empty (tool actually executed)
        assert result["tool_calls"][0]["result"] is not None

    # ── Loop detection ───────────────────────────────────────────────────────

    def test_identical_tool_call_loop_detected(self, session, mock_provider):
        """
        If the LLM calls the same tool with the same args twice in a row,
        the agent must detect the loop and return a user-facing message.
        """
        # Both iterations call search_businesses with identical args
        identical_call = {
            "content": None,
            "tool_calls": [{
                "id": "loop_01",
                "type": "function",
                "function": {
                    "name": "search_businesses",
                    "arguments": json.dumps({"city": "New York"}),
                },
            }],
            "finish_reason": "tool_calls",
            "raw": {},
        }
        mock_provider.set_script([identical_call, identical_call, identical_call])
        result = run_turn(session["id"], "Find restaurants", provider=mock_provider)
        assert result["loop_detected"] is True
        assert "loop" in result["reply"].lower() or "repeated" in result["reply"].lower()

    def test_loop_does_not_increase_call_count_beyond_one_repeat(self, session, mock_provider):
        """Loop must be caught on the second identical call, not the tenth."""
        identical_call = {
            "content": None,
            "tool_calls": [{
                "id": "loop_02",
                "type": "function",
                "function": {
                    "name": "get_health",
                    "arguments": "{}",
                },
            }],
            "finish_reason": "tool_calls",
            "raw": {},
        }
        mock_provider.set_script([identical_call] * 10)
        result = run_turn(session["id"], "ping", provider=mock_provider)
        # Should have executed the tool once, then detected loop on second call
        assert result["loop_detected"] is True
        # Only 1 tool call should have executed (the first one)
        assert len(result["tool_calls"]) <= 2

    def test_different_args_do_not_trigger_loop(self, session, mock_provider):
        """Two calls to the same tool with DIFFERENT args must not trigger loop detection."""
        mock_provider.set_script([
            {
                "content": None,
                "tool_calls": [{
                    "id": "tc_a",
                    "type": "function",
                    "function": {
                        "name": "search_businesses",
                        "arguments": json.dumps({"city": "New York"}),
                    },
                }],
                "finish_reason": "tool_calls",
                "raw": {},
            },
            {
                "content": None,
                "tool_calls": [{
                    "id": "tc_b",
                    "type": "function",
                    "function": {
                        "name": "search_businesses",
                        "arguments": json.dumps({"city": "London"}),  # different args
                    },
                }],
                "finish_reason": "tool_calls",
                "raw": {},
            },
            {
                "content": "Found results in both cities.",
                "tool_calls": None,
                "finish_reason": "stop",
                "raw": {},
            },
        ])
        result = run_turn(session["id"], "Compare NY and London", provider=mock_provider)
        assert result["loop_detected"] is False
        assert result["reply"] == "Found results in both cities."

    def test_max_tool_depth_guard_with_summary(self, session, mock_provider):
        """When MAX_TOOL_DEPTH is hit, return a summary, not a bare error."""
        # Script with more than 10 unique calls (each different to avoid loop detection)
        script = []
        for i in range(12):
            script.append({
                "content": None,
                "tool_calls": [{
                    "id": f"tc_{i:03d}",
                    "type": "function",
                    "function": {
                        "name": "get_health",
                        "arguments": json.dumps({"iteration": i}),  # different each time
                    },
                }],
                "finish_reason": "tool_calls",
                "raw": {},
            })
        mock_provider.set_script(script)
        result = run_turn(session["id"], "ping many", provider=mock_provider)
        # Should have a non-empty reply describing what happened
        assert len(result["reply"]) > 0
        assert result["loop_detected"] is False  # different args each time, not a loop

    def test_invalid_session_raises_value_error(self, mock_provider):
        with pytest.raises(ValueError, match="not found"):
            run_turn("nonexistent-session-xyz", "hello", provider=mock_provider)

    def test_provider_info_saved_to_session(self, session, mock_provider):
        mock_provider.set_script([
            {"content": "Done", "tool_calls": None, "finish_reason": "stop", "raw": {}},
        ])
        run_turn(session["id"], "test", provider=mock_provider)
        loaded = session_state.get_session(session["id"])
        assert loaded["provider"] == "mock"
        assert loaded["model"] == "mock-model-v1"


# ═══════════════════════════════════════════════════════════════════════════
# 7. Approval workflow tests
# ═══════════════════════════════════════════════════════════════════════════

class TestApprovalWorkflow:
    """
    Verifies the approval gate for state-changing tools.
    None of these tests require a real LLM — they drive the agent directly
    by scripting the LLM to attempt state-changing calls, then verify the gate.
    """

    def test_create_job_blocked_without_approval(self, session, mock_provider):
        """
        If the LLM tries to call create_scraping_job without the user having
        said yes/approved, the agent must block it and return a preview.
        """
        mock_provider.set_script([
            {
                "content": None,
                "tool_calls": [{
                    "id": "tc_job",
                    "type": "function",
                    "function": {
                        "name": "create_scraping_job",
                        "arguments": json.dumps({
                            "search_query": "restaurants in New York 10001",
                            "city": "New York",
                            "end_index": 5,
                        }),
                    },
                }],
                "finish_reason": "tool_calls",
                "raw": {},
            },
        ])
        # User did NOT say yes — just asked to find restaurants
        result = run_turn(
            session["id"],
            "Find 5 restaurants in New York, ZIP 10001",
            provider=mock_provider,
        )
        # Must be blocked
        blocked = any(
            tc.get("blocked_reason") == "awaiting_approval"
            for tc in result["tool_calls"]
        )
        assert blocked, "create_scraping_job was not blocked despite no approval"
        # Must contain confirmation prompt
        assert "yes" in result["reply"].lower() or "confirm" in result["reply"].lower()

    def test_create_job_blocked_cancel_message(self, session, mock_provider):
        """'cancel' is not an approval keyword — job must still be blocked."""
        mock_provider.set_script([
            {
                "content": None,
                "tool_calls": [{
                    "id": "tc_job2",
                    "type": "function",
                    "function": {
                        "name": "create_scraping_job",
                        "arguments": json.dumps({"search_query": "dentists London"}),
                    },
                }],
                "finish_reason": "tool_calls",
                "raw": {},
            },
        ])
        result = run_turn(
            session["id"],
            "actually cancel everything",
            provider=mock_provider,
        )
        blocked = any(tc.get("blocked_reason") for tc in result["tool_calls"])
        assert blocked

    def test_create_job_allowed_with_yes(self, session, mock_provider):
        """When the user says 'yes', create_scraping_job must be allowed through."""
        mock_provider.set_script([
            {
                "content": None,
                "tool_calls": [{
                    "id": "tc_job3",
                    "type": "function",
                    "function": {
                        "name": "create_scraping_job",
                        "arguments": json.dumps({
                            "search_query": "restaurants in New York 10001",
                            "city": "New York",
                            "end_index": 5,
                        }),
                    },
                }],
                "finish_reason": "tool_calls",
                "raw": {},
            },
            {
                "content": "Job created! I'll monitor it for you.",
                "tool_calls": None,
                "finish_reason": "stop",
                "raw": {},
            },
        ])
        result = run_turn(session["id"], "yes", provider=mock_provider)
        # Must NOT be blocked
        blocked = any(tc.get("blocked_reason") for tc in result["tool_calls"])
        assert not blocked, "create_scraping_job was blocked despite explicit 'yes'"
        assert result["reply"] == "Job created! I'll monitor it for you."

    def test_all_state_changing_tools_blocked_without_approval(self, session, mock_provider):
        """Every state-changing tool must be blocked without approval."""
        for tool_name in sorted(STATE_CHANGING_TOOLS):
            # Create a fresh session for each tool
            sub_session = session_state.create_session(title=f"test_{tool_name}")
            mock_provider.set_script([
                {
                    "content": None,
                    "tool_calls": [{
                        "id": f"tc_{tool_name}",
                        "type": "function",
                        "function": {
                            "name": tool_name,
                            "arguments": json.dumps({"format": "xlsx", "job_id": "j1"}),
                        },
                    }],
                    "finish_reason": "tool_calls",
                    "raw": {},
                },
            ])
            result = run_turn(sub_session["id"], "do something", provider=mock_provider)
            blocked = any(tc.get("blocked_reason") for tc in result["tool_calls"])
            assert blocked, f"{tool_name} was not blocked without approval"

    def test_read_only_tools_allowed_without_approval(self, session, mock_provider):
        """READ-ONLY tools must pass through without needing approval."""
        for tool_name in sorted(READ_ONLY_TOOLS):
            sub_session = session_state.create_session(title=f"test_ro_{tool_name}")
            mock_provider.set_script([
                {
                    "content": None,
                    "tool_calls": [{
                        "id": f"tc_{tool_name}",
                        "type": "function",
                        "function": {
                            "name": tool_name,
                            "arguments": json.dumps({"job_id": "j1", "per_page": 5}),
                        },
                    }],
                    "finish_reason": "tool_calls",
                    "raw": {},
                },
                {
                    "content": "Got the data.",
                    "tool_calls": None,
                    "finish_reason": "stop",
                    "raw": {},
                },
            ])
            result = run_turn(sub_session["id"], "show me data", provider=mock_provider)
            blocked = any(tc.get("blocked_reason") for tc in result["tool_calls"])
            assert not blocked, f"{tool_name} was wrongly blocked (read-only tool)"

    def test_config_preview_contains_required_fields(self, session, mock_provider):
        """The approval preview must mention key scraping parameters."""
        mock_provider.set_script([
            {
                "content": None,
                "tool_calls": [{
                    "id": "tc_cj",
                    "type": "function",
                    "function": {
                        "name": "create_scraping_job",
                        "arguments": json.dumps({
                            "search_query": "restaurants in New York 10001",
                            "category": "Restaurant",
                            "city": "New York",
                            "country": "United States",
                            "postal_code": "10001",
                            "end_index": 5,
                            "daily_limit": 500,
                        }),
                    },
                }],
                "finish_reason": "tool_calls",
                "raw": {},
            },
        ])
        result = run_turn(
            session["id"],
            "Find 5 restaurants in New York, ZIP 10001",
            provider=mock_provider,
        )
        preview = result["reply"].lower()
        # Must mention the key parameters
        assert "restaurants in new york" in preview or "search query" in preview or "new york" in preview
        assert "5" in preview or "max results" in preview or "10001" in preview

    def test_export_blocked_without_approval_then_allowed(self, session, mock_provider):
        """export_data: blocked on plain request, allowed after 'yes'."""
        # First turn — no approval
        mock_provider.set_script([
            {
                "content": None,
                "tool_calls": [{
                    "id": "tc_exp1",
                    "type": "function",
                    "function": {
                        "name": "export_data",
                        "arguments": json.dumps({"format": "xlsx"}),
                    },
                }],
                "finish_reason": "tool_calls",
                "raw": {},
            },
        ])
        result1 = run_turn(session["id"], "export everything", provider=mock_provider)
        blocked = any(tc.get("blocked_reason") for tc in result1["tool_calls"])
        assert blocked

        # Second turn — with approval
        sub_session = session_state.create_session(title="export_yes")
        mock_provider.set_script([
            {
                "content": None,
                "tool_calls": [{
                    "id": "tc_exp2",
                    "type": "function",
                    "function": {
                        "name": "export_data",
                        "arguments": json.dumps({"format": "xlsx"}),
                    },
                }],
                "finish_reason": "tool_calls",
                "raw": {},
            },
            {
                "content": "Export ready.",
                "tool_calls": None,
                "finish_reason": "stop",
                "raw": {},
            },
        ])
        result2 = run_turn(sub_session["id"], "yes export it", provider=mock_provider)
        blocked2 = any(tc.get("blocked_reason") for tc in result2["tool_calls"])
        assert not blocked2

    def test_job_created_does_not_auto_export(self, session, mock_provider):
        """
        After create_scraping_job succeeds, approval_granted is reset.
        A subsequent export_data call in the same turn must be blocked (approval gate),
        not looped (loop detection should not interfere here).
        """
        mock_provider.set_script([
            # Iteration 1: LLM calls create_scraping_job (allowed because user said "yes")
            {
                "content": None,
                "tool_calls": [{
                    "id": "tc_cj2",
                    "type": "function",
                    "function": {
                        "name": "create_scraping_job",
                        "arguments": json.dumps({"search_query": "gyms London"}),
                    },
                }],
                "finish_reason": "tool_calls",
                "raw": {},
            },
            # Iteration 2: LLM immediately tries to export (should be blocked by approval gate)
            {
                "content": None,
                "tool_calls": [{
                    "id": "tc_exp3",
                    "type": "function",
                    "function": {
                        "name": "export_data",
                        "arguments": json.dumps({"format": "xlsx", "job_id": "new-job"}),
                    },
                }],
                "finish_reason": "tool_calls",
                "raw": {},
            },
            # Iteration 3: never reached (agent returns early at approval gate)
            {
                "content": "This should not be reached.",
                "tool_calls": None,
                "finish_reason": "stop",
                "raw": {},
            },
        ])
        result = run_turn(session["id"], "yes start and export", provider=mock_provider)
        # The export should have been blocked by the approval gate
        export_blocked = any(
            tc["name"] == "export_data" and tc.get("blocked_reason")
            for tc in result["tool_calls"]
        )
        assert export_blocked, (
            f"export_data was not blocked after job creation. "
            f"tool_calls={result['tool_calls']}"
        )


# ═══════════════════════════════════════════════════════════════════════════
# 8. Agent API route tests
# ═══════════════════════════════════════════════════════════════════════════

class TestAgentRoutes:
    def test_list_providers(self, app_client):
        resp = app_client.get("/api/agent/providers")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "providers" in data
        assert any(p["name"] == "mock" for p in data["providers"])

    def test_list_tools(self, app_client):
        resp = app_client.get("/api/agent/tools")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["count"] >= 10

    def test_agent_health_mock(self, app_client):
        resp = app_client.get("/api/agent/health?provider=mock")
        assert resp.status_code == 200
        assert resp.get_json()["ok"] is True

    def test_create_session(self, app_client):
        resp = app_client.post("/api/agent/sessions",
                               json={"provider": "mock", "title": "Test"})
        assert resp.status_code == 201
        data = resp.get_json()
        assert "id" in data
        assert data["provider"] == "mock"

    def test_get_session(self, app_client):
        create = app_client.post("/api/agent/sessions", json={"provider": "mock"})
        sid = create.get_json()["id"]
        resp = app_client.get(f"/api/agent/sessions/{sid}")
        assert resp.status_code == 200
        assert resp.get_json()["id"] == sid

    def test_get_session_not_found(self, app_client):
        resp = app_client.get("/api/agent/sessions/nonexistent-xyz")
        assert resp.status_code == 404

    def test_list_sessions(self, app_client):
        app_client.post("/api/agent/sessions", json={"provider": "mock"})
        resp = app_client.get("/api/agent/sessions")
        assert resp.status_code == 200
        assert resp.get_json()["total"] >= 1

    def test_delete_session(self, app_client):
        create = app_client.post("/api/agent/sessions", json={"provider": "mock"})
        sid = create.get_json()["id"]
        assert app_client.delete(f"/api/agent/sessions/{sid}").status_code == 200
        assert app_client.get(f"/api/agent/sessions/{sid}").status_code == 404

    def test_chat_missing_message(self, app_client):
        create = app_client.post("/api/agent/sessions", json={"provider": "mock"})
        sid = create.get_json()["id"]
        resp = app_client.post(f"/api/agent/sessions/{sid}/chat", json={})
        assert resp.status_code == 400

    def test_chat_session_not_found(self, app_client):
        resp = app_client.post("/api/agent/sessions/nonexistent-xyz/chat",
                               json={"message": "hello"})
        assert resp.status_code == 404

    def test_chat_with_mock_provider_returns_reply(self, app_client):
        create = app_client.post("/api/agent/sessions", json={"provider": "mock"})
        sid = create.get_json()["id"]
        resp = app_client.post(
            f"/api/agent/sessions/{sid}/chat",
            json={"message": "Show me the dashboard", "provider": "mock"},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert "reply" in data
        assert data["session_id"] == sid

    def test_chat_history_accumulates(self, app_client):
        create = app_client.post("/api/agent/sessions", json={"provider": "mock"})
        sid = create.get_json()["id"]
        app_client.post(f"/api/agent/sessions/{sid}/chat",
                        json={"message": "Hello", "provider": "mock"})
        app_client.post(f"/api/agent/sessions/{sid}/chat",
                        json={"message": "What can you do?", "provider": "mock"})
        messages = app_client.get(f"/api/agent/sessions/{sid}").get_json()["messages"]
        assert len(messages) >= 4

    def test_invalid_provider_returns_400(self, app_client):
        create = app_client.post("/api/agent/sessions", json={"provider": "mock"})
        sid = create.get_json()["id"]
        resp = app_client.post(
            f"/api/agent/sessions/{sid}/chat",
            json={"message": "hi", "provider": "completely_invalid_provider"},
        )
        assert resp.status_code == 400

    def test_chat_response_includes_loop_detected_field(self, app_client):
        """API response must always include loop_detected field."""
        create = app_client.post("/api/agent/sessions", json={"provider": "mock"})
        sid = create.get_json()["id"]
        resp = app_client.post(
            f"/api/agent/sessions/{sid}/chat",
            json={"message": "Show me the dashboard", "provider": "mock"},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert "loop_detected" in data


# ═══════════════════════════════════════════════════════════════════════════
# Utility helpers
# ═══════════════════════════════════════════════════════════════════════════

class TestHelpers:
    def test_canonical_args_stable(self):
        a1 = _canonical_args({"city": "New York", "per_page": 5})
        a2 = _canonical_args({"per_page": 5, "city": "New York"})
        assert a1 == a2  # order-independent

    def test_canonical_args_different_for_different_inputs(self):
        a1 = _canonical_args({"city": "New York"})
        a2 = _canonical_args({"city": "London"})
        assert a1 != a2

    def test_user_approved_yes(self):
        assert _user_approved("yes") is True

    def test_user_approved_ok(self):
        assert _user_approved("ok sounds good") is True

    def test_user_approved_case_insensitive(self):
        assert _user_approved("YES please") is True

    def test_user_approved_negative(self):
        assert _user_approved("no thanks") is False
        assert _user_approved("what fields will it collect?") is False
        assert _user_approved("cancel") is False
