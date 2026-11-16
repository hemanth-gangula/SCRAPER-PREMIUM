"""
AI Agent main loop.

Flow for each user message:
  1. Load session history
  2. Append user message
  3. Send to LLM with tool schemas
  4. If LLM calls a tool:
       a. Reject if it's a STATE-CHANGING tool and no explicit approval exists
       b. Detect identical repeated call (loop guard)
       c. Execute → feed result back → repeat
  5. When LLM returns a text reply → persist → return

Loop detection: if the same (tool_name, canonical_args) pair appears twice
in a row with identical results, the loop is broken and the user is informed.

Tool classification:
  READ-ONLY     — safe to call any time
  STATE-CHANGING — requires the approval_granted flag to be True in this turn
                   OR the user message contains an explicit approval keyword.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from typing import Generator

from services.agent.provider import LLMProvider, get_provider
from services.agent.tools import TOOL_SCHEMAS, executor
from services.agent import state as session_state

logger = logging.getLogger(__name__)

# ── Tool classification ───────────────────────────────────────────────────────

READ_ONLY_TOOLS = frozenset([
    "search_businesses",
    "get_job_status",
    "list_jobs",
    "get_dashboard",
    "get_health",
    "wait_for_job",   # read-only: only polls, never mutates
])

STATE_CHANGING_TOOLS = frozenset([
    "create_scraping_job",
    "pause_job",
    "resume_job",
    "cancel_job",
    "export_data",    # triggers file generation, treated as state-changing
])

# Keywords that constitute explicit user approval for state-changing actions
APPROVAL_KEYWORDS = frozenset([
    "yes", "ok", "okay", "go", "start", "run", "do it", "approve",
    "confirmed", "confirm", "proceed", "execute", "yep", "sure",
    "go ahead", "let's go", "do that", "create it", "make it",
])

MAX_TOOL_DEPTH = 10  # hard cap on tool calls per turn


# ── System prompt ─────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are an AI assistant for Scraper Premium, an autonomous Google Maps business scraper.

Your capabilities (via tools):
- search_businesses: search the existing database (READ-ONLY)
- get_dashboard / get_health / list_jobs / get_job_status: system information (READ-ONLY)
- create_scraping_job: start a new Google Maps scrape (STATE-CHANGING — requires user confirmation)
- pause_job / resume_job / cancel_job: control running jobs (STATE-CHANGING)
- export_data: export to XLSX/CSV/JSON (STATE-CHANGING)
- wait_for_job: poll until a job completes (READ-ONLY)

CRITICAL WORKFLOW RULES:
1. ALWAYS call search_businesses first to check for existing data before creating a new job.
2. After searching, present the full scraping configuration as a preview table.
3. Ask the user to confirm ("Reply yes to start") — do NOT call create_scraping_job yet.
4. Only call create_scraping_job after the user has explicitly said yes/confirmed/approved.
5. RECORD LIMIT: When calling create_scraping_job, you MUST pass the EXACT number the user requested
   as BOTH end_index AND job_limit. If user said "5 businesses", pass end_index=5 AND job_limit=5.
   NEVER default to 100 when the user specified a smaller number. This is enforced server-side.
6. Never call the same tool with the same arguments twice in a row.
7. When a job completes, offer to export and ask which format.
8. Keep responses concise. Use markdown tables for configurations.
9. Never invent data — always use tool results."""


# ── Helpers ───────────────────────────────────────────────────────────────────

def _canonical_args(args: dict) -> str:
    """Stable JSON hash for loop detection."""
    return hashlib.md5(
        json.dumps(args, sort_keys=True, default=str).encode()
    ).hexdigest()


def _user_approved(text: str) -> bool:
    """Return True if the text contains an explicit approval keyword."""
    words = set(text.lower().split())
    # Also check multi-word phrases
    for phrase in APPROVAL_KEYWORDS:
        if " " in phrase and phrase in text.lower():
            return True
    return bool(words & APPROVAL_KEYWORDS)


def _log_tool_call(iteration: int, name: str, args: dict, result_str: str) -> None:
    """Structured log for tool execution. Never logs secret values."""
    # Truncate result to avoid flooding logs
    result_preview = result_str[:300] + ("…" if len(result_str) > 300 else "")
    # Redact any key that looks like a credential (never present in our tools, but be safe)
    safe_args = {
        k: ("***" if any(s in k.lower() for s in ("key", "token", "secret", "password")) else v)
        for k, v in args.items()
    }
    logger.info(
        "[agent] iter=%d tool=%s args=%s result_preview=%s",
        iteration, name, json.dumps(safe_args, default=str)[:200], result_preview,
    )


# ── Main turn function ────────────────────────────────────────────────────────

def run_turn(
    session_id: str,
    user_message: str,
    provider: LLMProvider | None = None,
) -> dict:
    """
    Process one user turn within a session.

    Returns
    -------
    dict:
        reply        : str
        tool_calls   : list[{name, args, result, blocked_reason?}]
        session_id   : str
        loop_detected: bool
    """
    if provider is None:
        provider = get_provider()

    session = session_state.get_session(session_id)
    if session is None:
        raise ValueError(f"Session {session_id} not found")

    # Load history snapshot BEFORE appending the new user message
    history_snapshot = list(session.get("messages", []))

    # Persist the new user message
    user_msg = {"role": "user", "content": user_message}
    session_state.append_message(session_id, user_msg)

    # Build the LLM message list
    messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend(history_snapshot)
    messages.append(user_msg)

    # Was this message an explicit approval?
    approval_granted = _user_approved(user_message)

    tool_calls_log: list[dict] = []
    loop_detected = False

    # Loop detection state: track last (tool_name, args_hash) pair
    last_call_signature: str | None = None

    depth = 0

    while depth < MAX_TOOL_DEPTH:
        depth += 1
        logger.info("[agent] iter=%d calling LLM (session=%s)", depth, session_id[:8])

        response = provider.chat(messages, tools=TOOL_SCHEMAS)

        finish = response.get("finish_reason", "stop")
        content = response.get("content")
        tool_calls = response.get("tool_calls")

        # Build assistant message for history
        assistant_msg: dict = {"role": "assistant"}
        if content:
            assistant_msg["content"] = content
        if tool_calls:
            assistant_msg["tool_calls"] = tool_calls
        if not content and not tool_calls:
            assistant_msg["content"] = ""

        messages.append(assistant_msg)

        # ── No tool calls → final text reply ─────────────────────────────
        if finish != "tool_calls" or not tool_calls:
            final_reply = content or ""
            session_state.append_message(session_id, assistant_msg)
            session_state.update_session(
                session_id,
                provider=provider.name,
                model=provider.model,
            )
            return {
                "reply":         final_reply,
                "tool_calls":    tool_calls_log,
                "session_id":    session_id,
                "loop_detected": loop_detected,
            }

        # ── Execute tool calls ────────────────────────────────────────────
        for tc in tool_calls:
            fn_name = tc["function"]["name"]
            tc_id   = tc["id"]

            try:
                args = json.loads(tc["function"].get("arguments", "{}"))
            except json.JSONDecodeError:
                args = {}

            # ── Loop detection ────────────────────────────────────────────
            call_sig = f"{fn_name}:{_canonical_args(args)}"
            if call_sig == last_call_signature:
                loop_detected = True
                logger.warning(
                    "[agent] LOOP DETECTED iter=%d tool=%s args_hash=%s — breaking",
                    depth, fn_name, call_sig,
                )
                loop_reply = (
                    f"⚠️ I detected a repeated identical call to **{fn_name}** "
                    f"with the same arguments. This would create an infinite loop, so I stopped.\n\n"
                    f"Here's what I found before stopping:\n\n"
                    + (
                        "\n".join(
                            f"- **{tc['name']}**: {json.dumps(tc['result'])[:200]}"
                            for tc in tool_calls_log
                        ) or "*(no results yet)*"
                    )
                    + "\n\nPlease rephrase your request or ask a more specific question."
                )
                loop_msg = {"role": "assistant", "content": loop_reply}
                session_state.append_message(session_id, loop_msg)
                return {
                    "reply":         loop_reply,
                    "tool_calls":    tool_calls_log,
                    "session_id":    session_id,
                    "loop_detected": True,
                }
            last_call_signature = call_sig

            # ── Approval gate for state-changing tools ────────────────────
            if fn_name in STATE_CHANGING_TOOLS and not approval_granted:
                # Build a helpful preview instead of blocking silently
                blocked_reply = _build_approval_request(fn_name, args)
                blocked_msg = {"role": "assistant", "content": blocked_reply}
                session_state.append_message(session_id, blocked_msg)
                tool_calls_log.append({
                    "name":           fn_name,
                    "args":           args,
                    "result":         {},
                    "blocked_reason": "awaiting_approval",
                })
                return {
                    "reply":         blocked_reply,
                    "tool_calls":    tool_calls_log,
                    "session_id":    session_id,
                    "loop_detected": False,
                }

            # ── Execute ───────────────────────────────────────────────────
            result_str = executor.execute(fn_name, args)
            _log_tool_call(depth, fn_name, args, result_str)

            try:
                result_data = json.loads(result_str)
            except Exception:
                result_data = {"raw": result_str}

            # Track job IDs
            job_id = result_data.get("job_id")
            if job_id:
                session_state.track_job(session_id, job_id)

            # After create_scraping_job SUCCEEDS, reset approval to prevent
            # the LLM from auto-chaining into export_data without asking again.
            # If the tool errored (no job_id), keep approval active so the LLM
            # can retry with corrected arguments.
            if fn_name == "create_scraping_job" and job_id:
                approval_granted = False

            # If the tool returned an error, clear the loop detection signature
            # so a corrected retry with slightly different args is not flagged.
            tool_errored = "error" in result_data
            if tool_errored:
                last_call_signature = None

            tool_calls_log.append({
                "name":   fn_name,
                "args":   args,
                "result": result_data,
            })

            # Feed result back to LLM
            messages.append({
                "role":         "tool",
                "tool_call_id": tc_id,
                "content":      result_str,
            })

    # ── Hit MAX_TOOL_DEPTH without a text reply ───────────────────────────────
    summary_lines = [
        f"- **{tc['name']}**: {json.dumps(tc['result'])[:150]}"
        for tc in tool_calls_log
    ]
    safety_reply = (
        f"I've reached the maximum of {MAX_TOOL_DEPTH} tool calls for this turn "
        f"without producing a final answer. Here's a summary of what was retrieved:\n\n"
        + ("\n".join(summary_lines) or "*(no results)*")
        + "\n\nPlease break your request into smaller steps."
    )
    safety_msg = {"role": "assistant", "content": safety_reply}
    session_state.append_message(session_id, safety_msg)
    return {
        "reply":         safety_reply,
        "tool_calls":    tool_calls_log,
        "session_id":    session_id,
        "loop_detected": False,
    }


def _build_approval_request(tool_name: str, args: dict) -> str:
    """Build a human-readable confirmation request for a state-changing tool call."""
    if tool_name == "create_scraping_job":
        query    = args.get("search_query", "N/A")
        city     = args.get("city", "")
        country  = args.get("country", "")
        limit    = args.get("end_index", args.get("job_limit", 20))
        postal   = args.get("postal_code", "")
        location = ", ".join(filter(None, [city, country, postal]))

        return (
            f"Here is the scraping configuration I'd like to run:\n\n"
            f"| Parameter | Value |\n"
            f"|---|---|\n"
            f"| **Search query** | `{query}` |\n"
            f"| **Location** | {location or '—'} |\n"
            f"| **Category** | {args.get('category', '—')} |\n"
            f"| **Max results** | {limit} |\n"
            f"| **Daily limit** | {args.get('daily_limit', 500)} |\n"
            f"\n**Fields collected:** name, address, phone, website, email, rating\n\n"
            f"Reply **`yes`** to start scraping, or tell me to adjust any parameter."
        )

    if tool_name == "export_data":
        fmt = args.get("format", "xlsx").upper()
        filters = {k: v for k, v in args.items() if k != "format" and v}
        filter_str = ", ".join(f"{k}={v}" for k, v in filters.items()) if filters else "all records"
        return (
            f"I'll export your data as **{fmt}** ({filter_str}).\n\n"
            f"Reply **`yes`** to generate the export file."
        )

    if tool_name in ("pause_job", "resume_job", "cancel_job"):
        action = tool_name.replace("_job", "")
        return (
            f"I'm about to **{action}** job `{args.get('job_id', '?')}`. "
            f"Reply **`yes`** to confirm."
        )

    # Generic fallback
    return (
        f"I need your confirmation before executing **{tool_name}**. "
        f"Reply **`yes`** to proceed."
    )


# ── Streaming variant ─────────────────────────────────────────────────────────

def run_turn_stream(
    session_id: str,
    user_message: str,
    provider: LLMProvider | None = None,
) -> Generator[str, None, None]:
    """
    Streaming variant — yields Server-Sent Events.

    Event types:
      tool_call        : {type, tool, args}
      tool_result      : {type, tool, result}
      tool_blocked     : {type, tool, reason}
      loop_detected    : {type, tool}
      reply_start      : {type}
      reply_chunk      : {type, chunk}
      reply_end        : {type, session_id, loop_detected}
      error            : {type, message}
    """
    def _event(data: dict) -> str:
        return f"data: {json.dumps(data)}\n\n"

    try:
        result = run_turn(session_id, user_message, provider)

        for tc in result.get("tool_calls", []):
            if tc.get("blocked_reason"):
                yield _event({"type": "tool_blocked", "tool": tc["name"],
                               "reason": tc["blocked_reason"]})
            else:
                yield _event({"type": "tool_call",   "tool": tc["name"], "args": tc["args"]})
                yield _event({"type": "tool_result", "tool": tc["name"], "result": tc["result"]})
            time.sleep(0.05)

        if result.get("loop_detected"):
            yield _event({"type": "loop_detected"})

        reply = result.get("reply", "")
        yield _event({"type": "reply_start"})
        chunk_size = 20
        for i in range(0, len(reply), chunk_size):
            yield _event({"type": "reply_chunk", "chunk": reply[i:i + chunk_size]})
            time.sleep(0.01)

        yield _event({
            "type":          "reply_end",
            "session_id":    session_id,
            "loop_detected": result.get("loop_detected", False),
        })

    except Exception as exc:
        logger.exception("[agent] turn failed session=%s", session_id[:8])
        yield _event({"type": "error", "message": str(exc)})
