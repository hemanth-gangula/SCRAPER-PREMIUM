"""
Configurable LLM provider interface.

Supported providers (all optional — none mandatory):
  - groq       : Groq API (llama3, mixtral, etc.)
  - openai     : OpenAI API (gpt-4o, gpt-3.5-turbo, etc.)
  - anthropic  : Anthropic API (claude-3-haiku, claude-3-sonnet, etc.)
  - local      : Any OpenAI-compatible local server (Ollama, LM Studio, etc.)
  - mock       : In-process deterministic mock — requires NO API key, used for tests

Set LLM_PROVIDER in .env to pick the provider.
Set LLM_API_KEY (or provider-specific key) for the chosen provider.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from abc import ABC, abstractmethod
from typing import Any

from config import config

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Base interface
# ---------------------------------------------------------------------------

class LLMProvider(ABC):
    """Abstract base — all providers implement this interface."""

    @abstractmethod
    def chat(
        self,
        messages: list[dict],
        tools: list[dict] | None = None,
        tool_choice: str = "auto",
    ) -> dict:
        """
        Send a chat completion request.

        Parameters
        ----------
        messages   : OpenAI-style message list [{role, content}, ...]
        tools      : Optional list of tool schemas (OpenAI function-calling format)
        tool_choice: "auto" | "none" | specific tool name

        Returns
        -------
        dict with keys:
          content     : str | None   — assistant text reply (None if tool call)
          tool_calls  : list | None  — list of tool call dicts
          finish_reason: str         — "stop" | "tool_calls" | "length"
          raw         : dict         — full provider response (for debugging)
        """

    @property
    @abstractmethod
    def name(self) -> str:
        """Human-readable provider name."""

    @property
    @abstractmethod
    def model(self) -> str:
        """Model identifier being used."""

    def health_check(self) -> dict:
        """Quick reachability test. Returns {ok: bool, error: str|None}."""
        try:
            resp = self.chat([{"role": "user", "content": "ping"}])
            return {"ok": True, "error": None, "provider": self.name, "model": self.model}
        except Exception as exc:
            return {"ok": False, "error": str(exc), "provider": self.name, "model": self.model}


# ---------------------------------------------------------------------------
# Groq provider
# ---------------------------------------------------------------------------

class GroqProvider(LLMProvider):
    def __init__(self, api_key: str | None = None, model: str | None = None):
        self._api_key = api_key or config.GROQ_API_KEY
        if not self._api_key:
            raise ValueError("GROQ_API_KEY not set. Set it in .env or pass api_key=")
        self._model = model or config.GROQ_MODEL or "llama3-70b-8192"

    @property
    def name(self) -> str:
        return "groq"

    @property
    def model(self) -> str:
        return self._model

    def chat(self, messages, tools=None, tool_choice="auto"):
        import requests
        import time as _time

        payload: dict[str, Any] = {
            "model": self._model,
            "messages": messages,
            "max_tokens": 2048,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = tool_choice

        # Retry with exponential back-off on 429 (rate limit)
        # Also retry once on 400 (may be transient/context issue)
        max_retries = 4
        backoff = 10  # seconds
        last_status = 0
        for attempt in range(max_retries):
            resp = requests.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=60,
            )
            last_status = resp.status_code
            if resp.status_code == 429 and attempt < max_retries - 1:
                retry_after = int(resp.headers.get("retry-after", backoff))
                wait = max(retry_after, backoff)
                logger.warning(
                    "[groq] Rate limited (429) — waiting %ds before retry %d/%d",
                    wait, attempt + 1, max_retries - 1,
                )
                _time.sleep(wait)
                backoff = min(backoff * 2, 60)
                continue
            # 400 on first attempt — wait briefly and retry once (may be transient)
            if resp.status_code == 400 and attempt == 0:
                logger.warning("[groq] Got 400 on first attempt — waiting 8s and retrying")
                _time.sleep(8)
                continue
            resp.raise_for_status()
            break

        data = resp.json()
        choice = data["choices"][0]
        msg = choice["message"]
        return {
            "content": msg.get("content"),
            "tool_calls": msg.get("tool_calls"),
            "finish_reason": choice.get("finish_reason", "stop"),
            "raw": data,
        }


# ---------------------------------------------------------------------------
# OpenAI provider
# ---------------------------------------------------------------------------

class OpenAIProvider(LLMProvider):
    def __init__(self, api_key: str | None = None, model: str | None = None):
        self._api_key = api_key or os.getenv("OPENAI_API_KEY", "")
        if not self._api_key:
            raise ValueError("OPENAI_API_KEY not set. Set it in .env or pass api_key=")
        self._model = model or os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    @property
    def name(self) -> str:
        return "openai"

    @property
    def model(self) -> str:
        return self._model

    def chat(self, messages, tools=None, tool_choice="auto"):
        import requests

        payload: dict[str, Any] = {
            "model": self._model,
            "messages": messages,
            "max_tokens": 2048,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = tool_choice

        resp = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=60,
        )
        resp.raise_for_status()
        data = resp.json()
        choice = data["choices"][0]
        msg = choice["message"]
        return {
            "content": msg.get("content"),
            "tool_calls": msg.get("tool_calls"),
            "finish_reason": choice.get("finish_reason", "stop"),
            "raw": data,
        }


# ---------------------------------------------------------------------------
# Anthropic provider
# ---------------------------------------------------------------------------

class AnthropicProvider(LLMProvider):
    def __init__(self, api_key: str | None = None, model: str | None = None):
        self._api_key = api_key or os.getenv("ANTHROPIC_API_KEY", "")
        if not self._api_key:
            raise ValueError("ANTHROPIC_API_KEY not set.")
        self._model = model or os.getenv("ANTHROPIC_MODEL", "claude-3-haiku-20240307")

    @property
    def name(self) -> str:
        return "anthropic"

    @property
    def model(self) -> str:
        return self._model

    def _convert_tools(self, tools: list[dict]) -> list[dict]:
        converted = []
        for t in tools:
            if t.get("type") == "function":
                fn = t["function"]
                converted.append({
                    "name": fn["name"],
                    "description": fn.get("description", ""),
                    "input_schema": fn.get("parameters", {"type": "object", "properties": {}}),
                })
        return converted

    def _convert_messages(self, messages: list[dict]) -> tuple[str | None, list[dict]]:
        system = None
        converted = []
        for m in messages:
            role = m["role"]
            if role == "system":
                system = m["content"]
            elif role == "tool":
                converted.append({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": m.get("tool_call_id", ""),
                        "content": m.get("content", ""),
                    }],
                })
            else:
                converted.append(m)
        return system, converted

    def chat(self, messages, tools=None, tool_choice="auto"):
        import requests

        system, msgs = self._convert_messages(messages)
        payload: dict[str, Any] = {
            "model": self._model,
            "max_tokens": 2048,
            "messages": msgs,
        }
        if system:
            payload["system"] = system
        if tools:
            payload["tools"] = self._convert_tools(tools)
            if tool_choice != "none":
                payload["tool_choice"] = {"type": "auto"}

        resp = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": self._api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=60,
        )
        resp.raise_for_status()
        data = resp.json()

        content_text = None
        tool_calls = None
        finish_reason = "stop"

        for block in data.get("content", []):
            if block["type"] == "text":
                content_text = block["text"]
            elif block["type"] == "tool_use":
                if tool_calls is None:
                    tool_calls = []
                tool_calls.append({
                    "id": block["id"],
                    "type": "function",
                    "function": {
                        "name": block["name"],
                        "arguments": json.dumps(block.get("input", {})),
                    },
                })
                finish_reason = "tool_calls"

        stop_reason = data.get("stop_reason", "end_turn")
        if stop_reason == "tool_use":
            finish_reason = "tool_calls"

        return {
            "content": content_text,
            "tool_calls": tool_calls,
            "finish_reason": finish_reason,
            "raw": data,
        }


# ---------------------------------------------------------------------------
# Local / OpenAI-compatible provider (Ollama, LM Studio, etc.)
# ---------------------------------------------------------------------------

class LocalProvider(LLMProvider):
    def __init__(self, base_url: str | None = None, model: str | None = None, api_key: str | None = None):
        self._base_url = (base_url or os.getenv("LOCAL_LLM_URL", "http://localhost:11434/v1")).rstrip("/")
        self._model = model or os.getenv("LOCAL_LLM_MODEL", "llama3")
        self._api_key = api_key or os.getenv("LOCAL_LLM_API_KEY", "ollama")

    @property
    def name(self) -> str:
        return "local"

    @property
    def model(self) -> str:
        return self._model

    def chat(self, messages, tools=None, tool_choice="auto"):
        import requests

        payload: dict[str, Any] = {
            "model": self._model,
            "messages": messages,
            "max_tokens": 2048,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = tool_choice

        resp = requests.post(
            f"{self._base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=120,
        )
        resp.raise_for_status()
        data = resp.json()
        choice = data["choices"][0]
        msg = choice["message"]
        return {
            "content": msg.get("content"),
            "tool_calls": msg.get("tool_calls"),
            "finish_reason": choice.get("finish_reason", "stop"),
            "raw": data,
        }


# ---------------------------------------------------------------------------
# Mock provider — no API key needed, used for tests and UI demo
# ---------------------------------------------------------------------------

class MockProvider(LLMProvider):
    """
    Deterministic mock that simulates a helpful LLM agent.

    Without a script: uses a built-in state machine that understands the
    scraping workflow:
      1. First call → check existing data (search_businesses)
      2. After search result → present config preview and ask for approval
      3. Never calls create_scraping_job without an explicit "yes/approve" message
      4. After approval message → create job, then text reply
      5. After job created → offer export

    With set_script(): replays the scripted responses sequentially (for unit tests).

    Tool call IDs are unique UUIDs on every call to avoid ID collisions in history.
    """

    # Keywords that constitute explicit user approval
    APPROVAL_KEYWORDS = frozenset([
        "yes", "ok", "okay", "go", "start", "run", "do it", "approve",
        "confirmed", "confirm", "proceed", "execute", "yep", "sure",
    ])

    def __init__(self, model: str | None = None):  # accept but ignore model param
        self._call_index = 0
        self._scripted: list[dict] | None = None
        # Internal state for the unscripted state machine
        self._state = "idle"  # idle → searched → awaiting_approval → job_created
        self._pending_config: dict | None = None

    def set_script(self, script: list[dict]) -> None:
        """Pre-load a list of responses for sequential calls. Resets state machine."""
        self._scripted = script
        self._call_index = 0
        self._state = "idle"
        self._pending_config = None

    def reset(self) -> None:
        """Reset state machine to initial state."""
        self._scripted = None
        self._call_index = 0
        self._state = "idle"
        self._pending_config = None

    @property
    def name(self) -> str:
        return "mock"

    @property
    def model(self) -> str:
        return "mock-model-v1"

    @staticmethod
    def _make_tool_call(tool_name: str, args: dict) -> dict:
        """Build a properly-formed tool call dict with a unique ID."""
        return {
            "id": f"mock_{uuid.uuid4().hex[:12]}",
            "type": "function",
            "function": {
                "name": tool_name,
                "arguments": json.dumps(args),
            },
        }

    def _extract_last_user(self, messages: list[dict]) -> str:
        """Return the most recent user message text."""
        for m in reversed(messages):
            if m.get("role") == "user":
                content = m.get("content", "")
                return content if isinstance(content, str) else ""
        return ""

    def _extract_last_tool_result(self, messages: list[dict]) -> dict | None:
        """Return the parsed content of the most recent tool result message."""
        for m in reversed(messages):
            if m.get("role") == "tool":
                try:
                    return json.loads(m["content"])
                except Exception:
                    return None
        return None

    def _is_approval(self, text: str) -> bool:
        words = set(text.lower().split())
        return bool(words & self.APPROVAL_KEYWORDS)

    def _parse_scraping_intent(self, text: str) -> dict | None:
        """
        Very simple intent parser — extracts city/ZIP/count/category from user text.
        Returns a config dict or None if no scraping intent is detected.
        """
        text_lower = text.lower()
        # Only trigger on clear scraping requests
        scraping_verbs = ["find", "scrape", "get", "collect", "search for", "look for"]
        if not any(v in text_lower for v in scraping_verbs):
            return None

        import re

        # Category
        categories = ["restaurant", "dentist", "lawyer", "hotel", "gym", "pharmacy",
                      "cafe", "bar", "shop", "clinic", "school", "plumber"]
        category = next((c for c in categories if c in text_lower), "business")

        # Count
        count_match = re.search(r"\b(\d+)\b", text)
        count = int(count_match.group(1)) if count_match else 20

        # City
        city_match = re.search(r"\bin\s+([A-Za-z ]+?)(?:\s*,|\s+zip|\s+\d{5}|$)", text, re.IGNORECASE)
        city = city_match.group(1).strip() if city_match else "New York"

        # ZIP
        zip_match = re.search(r"\b(\d{5})\b", text)
        postal_code = zip_match.group(1) if zip_match else ""

        return {
            "search_query": f"{category}s in {city}" + (f" {postal_code}" if postal_code else ""),
            "category":     category.capitalize(),
            "city":         city,
            "country":      "United States",
            "postal_code":  postal_code,
            "end_index":    count,
            "job_limit":    count,
            "daily_limit":  500,
        }

    def chat(self, messages: list[dict], tools=None, tool_choice="auto") -> dict:
        # ── Scripted mode ────────────────────────────────────────────────────
        if self._scripted is not None:
            resp = self._scripted[min(self._call_index, len(self._scripted) - 1)]
            self._call_index += 1
            return resp

        # ── State-machine mode ───────────────────────────────────────────────
        last_user = self._extract_last_user(messages)
        last_tool_result = self._extract_last_tool_result(messages)

        # ── State: idle — first call in a turn ───────────────────────────────
        if self._state == "idle":
            config = self._parse_scraping_intent(last_user)

            if config and tools:
                # Store pending config and check existing data first
                self._pending_config = config
                self._state = "searching"
                return {
                    "content": None,
                    "tool_calls": [self._make_tool_call("search_businesses", {
                        "query":    config["category"],
                        "city":     config["city"],
                        "per_page": 5,
                    })],
                    "finish_reason": "tool_calls",
                    "raw": {},
                }

            # Non-scraping request — just respond
            if tools and "dashboard" in last_user.lower():
                return {
                    "content": None,
                    "tool_calls": [self._make_tool_call("get_dashboard", {})],
                    "finish_reason": "tool_calls",
                    "raw": {},
                }
            if tools and "health" in last_user.lower():
                return {
                    "content": None,
                    "tool_calls": [self._make_tool_call("get_health", {})],
                    "finish_reason": "tool_calls",
                    "raw": {},
                }
            if tools and ("export" in last_user.lower() or "excel" in last_user.lower()):
                return {
                    "content": None,
                    "tool_calls": [self._make_tool_call("export_data", {"format": "xlsx"})],
                    "finish_reason": "tool_calls",
                    "raw": {},
                }
            if tools and ("job" in last_user.lower() or "running" in last_user.lower()):
                return {
                    "content": None,
                    "tool_calls": [self._make_tool_call("list_jobs", {"per_page": 10})],
                    "finish_reason": "tool_calls",
                    "raw": {},
                }

            # Generic response
            return {
                "content": f"I can help you with that. I have access to your scraper database, jobs, and export tools. What would you like to do?\n\n(Mock provider active — connect a real LLM via GROQ_API_KEY for full AI capabilities.)",
                "tool_calls": None,
                "finish_reason": "stop",
                "raw": {},
            }

        # ── State: searching — received search_businesses result ─────────────
        if self._state == "searching":
            self._state = "awaiting_approval"
            cfg = self._pending_config or {}
            existing_count = 0
            if last_tool_result and isinstance(last_tool_result, dict):
                existing_count = last_tool_result.get("total", 0)

            existing_note = (
                f"\n\n> ℹ️ Found **{existing_count} existing records** matching this search. "
                "If you proceed, duplicates will be automatically skipped."
                if existing_count > 0
                else "\n\n> ℹ️ No existing records found — this will be a fresh scrape."
            )

            preview = (
                f"Here is the scraping configuration:\n\n"
                f"| Parameter | Value |\n"
                f"|---|---|\n"
                f"| **Search query** | `{cfg.get('search_query', 'N/A')}` |\n"
                f"| **Category** | {cfg.get('category', 'N/A')} |\n"
                f"| **City** | {cfg.get('city', 'N/A')} |\n"
                f"| **Country** | {cfg.get('country', 'N/A')} |\n"
                f"| **Postal code** | {cfg.get('postal_code', '—')} |\n"
                f"| **Max results** | {cfg.get('end_index', 20)} |\n"
                f"| **Daily limit** | {cfg.get('daily_limit', 500)} |\n"
                f"\n**Fields collected:** name, address, phone, website, email, rating, quality score"
                f"{existing_note}\n\n"
                f"**Reply `yes` to start scraping, or tell me to change any parameter.**"
            )

            return {
                "content": preview,
                "tool_calls": None,
                "finish_reason": "stop",
                "raw": {},
            }

        # ── State: awaiting_approval ─────────────────────────────────────────
        if self._state == "awaiting_approval":
            if self._is_approval(last_user):
                self._state = "job_created"
                cfg = self._pending_config or {"search_query": "businesses"}
                return {
                    "content": None,
                    "tool_calls": [self._make_tool_call("create_scraping_job", cfg)],
                    "finish_reason": "tool_calls",
                    "raw": {},
                }
            else:
                # User didn't approve — check if they're changing parameters
                new_config = self._parse_scraping_intent(last_user)
                if new_config:
                    self._pending_config = new_config
                    self._state = "searching"
                    return {
                        "content": None,
                        "tool_calls": [self._make_tool_call("search_businesses", {
                            "query":    new_config["category"],
                            "city":     new_config["city"],
                            "per_page": 5,
                        })],
                        "finish_reason": "tool_calls",
                        "raw": {},
                    }
                # Ambiguous — re-ask
                return {
                    "content": (
                        "I'm ready to start scraping once you confirm. "
                        "Reply **`yes`** to proceed, or tell me what you'd like to change.\n\n"
                        f"Current query: `{(self._pending_config or {}).get('search_query', 'N/A')}`"
                    ),
                    "tool_calls": None,
                    "finish_reason": "stop",
                    "raw": {},
                }

        # ── State: job_created — got create_scraping_job result ──────────────
        if self._state == "job_created":
            job_id = "unknown"
            if last_tool_result and isinstance(last_tool_result, dict):
                job_id = last_tool_result.get("job_id", "unknown")

            self._state = "idle"  # reset for next turn
            self._pending_config = None

            return {
                "content": (
                    f"✅ **Scraping job created** — Job ID: `{job_id}`\n\n"
                    f"The scraper is now running. You can:\n"
                    f"- Ask me to **check the status** at any time\n"
                    f"- Ask me to **wait for completion** and then export\n"
                    f"- Say **export to Excel** when it finishes\n\n"
                    f"What would you like to do?"
                ),
                "tool_calls": None,
                "finish_reason": "stop",
                "raw": {},
            }

        # ── Fallback ─────────────────────────────────────────────────────────
        self._state = "idle"
        return {
            "content": "I'm ready to help. What would you like to do?",
            "tool_calls": None,
            "finish_reason": "stop",
            "raw": {},
        }


# ---------------------------------------------------------------------------
# Factory function
# ---------------------------------------------------------------------------

_PROVIDERS = {
    "groq":      GroqProvider,
    "openai":    OpenAIProvider,
    "anthropic": AnthropicProvider,
    "local":     LocalProvider,
    "mock":      MockProvider,
}


def get_provider(provider_name: str | None = None, **kwargs) -> LLMProvider:
    """
    Instantiate and return an LLM provider.

    provider_name defaults to the LLM_PROVIDER env var, then tries
    Groq (if GROQ_API_KEY set), then mock.
    """
    name = (provider_name or os.getenv("LLM_PROVIDER", "")).lower()

    if not name:
        # Auto-detect based on available keys
        if os.getenv("GROQ_API_KEY") or config.GROQ_API_KEY:
            name = "groq"
        elif os.getenv("OPENAI_API_KEY"):
            name = "openai"
        elif os.getenv("ANTHROPIC_API_KEY"):
            name = "anthropic"
        else:
            name = "mock"

    if name not in _PROVIDERS:
        raise ValueError(
            f"Unknown LLM provider '{name}'. "
            f"Supported: {', '.join(_PROVIDERS.keys())}"
        )

    return _PROVIDERS[name](**kwargs)


def list_providers() -> list[dict]:
    """Return info about all supported providers and their configuration status."""
    return [
        {
            "name": "groq",
            "configured": bool(os.getenv("GROQ_API_KEY") or config.GROQ_API_KEY),
            "env_var": "GROQ_API_KEY",
            "models": ["openai/gpt-oss-20b", "openai/gpt-oss-120b", "qwen/qwen3.8-27b"],
        },
        {
            "name": "openai",
            "configured": bool(os.getenv("OPENAI_API_KEY")),
            "env_var": "OPENAI_API_KEY",
            "models": ["gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo"],
        },
        {
            "name": "anthropic",
            "configured": bool(os.getenv("ANTHROPIC_API_KEY")),
            "env_var": "ANTHROPIC_API_KEY",
            "models": ["claude-3-haiku-20240307", "claude-3-sonnet-20240229", "claude-3-opus-20240229"],
        },
        {
            "name": "local",
            "configured": bool(os.getenv("LOCAL_LLM_URL")),
            "env_var": "LOCAL_LLM_URL",
            "models": ["llama3", "mistral", "phi3"],
        },
        {
            "name": "mock",
            "configured": True,  # always available
            "env_var": None,
            "models": ["mock-model-v1"],
        },
    ]
