"""
Agent API routes.

Endpoints
─────────
POST   /api/agent/sessions                   Create a new chat session
GET    /api/agent/sessions                   List all sessions
GET    /api/agent/sessions/<id>              Get session with full message history
DELETE /api/agent/sessions/<id>              Delete session
POST   /api/agent/sessions/<id>/chat         Send a message (non-streaming)
GET    /api/agent/sessions/<id>/chat/stream  Send a message (SSE streaming)
GET    /api/agent/providers                  List available LLM providers + status
GET    /api/agent/health                     Check if LLM is reachable
"""

from __future__ import annotations

import json
import logging
from flask import Blueprint, jsonify, request, Response, stream_with_context

from services.agent import state as session_state
from services.agent.agent import run_turn, run_turn_stream
from services.agent.provider import get_provider, list_providers
from services.agent.tools import TOOL_SCHEMAS

logger = logging.getLogger(__name__)
bp = Blueprint("agent", __name__)


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------

@bp.route("/agent/sessions", methods=["POST"])
def create_session():
    """Create a new agent session."""
    body = request.get_json(silent=True) or {}
    provider_name = body.get("provider", "")
    model = body.get("model", "")
    title = body.get("title", "")

    # Resolve provider info (don't instantiate yet — just get defaults)
    if not provider_name:
        providers = list_providers()
        for p in providers:
            if p["configured"]:
                provider_name = p["name"]
                break
        provider_name = provider_name or "mock"

    session = session_state.create_session(
        title=title,
        provider=provider_name,
        model=model,
    )
    return jsonify(session), 201


@bp.route("/agent/sessions", methods=["GET"])
def list_sessions():
    """List recent sessions."""
    limit = int(request.args.get("limit", 50))
    sessions = session_state.list_sessions(limit=limit)
    return jsonify({"sessions": sessions, "total": len(sessions)})


@bp.route("/agent/sessions/<session_id>", methods=["GET"])
def get_session(session_id: str):
    """Get session with full message history."""
    session = session_state.get_session(session_id)
    if session is None:
        return jsonify({"error": "Session not found"}), 404
    return jsonify(session)


@bp.route("/agent/sessions/<session_id>", methods=["DELETE"])
def delete_session(session_id: str):
    """Delete a session."""
    deleted = session_state.delete_session(session_id)
    if not deleted:
        return jsonify({"error": "Session not found"}), 404
    return jsonify({"deleted": True, "session_id": session_id})


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------

@bp.route("/agent/sessions/<session_id>/chat", methods=["POST"])
def chat(session_id: str):
    """
    Send a message to the agent.
    
    Body: { "message": "...", "provider": "groq"|"openai"|...(optional) }
    Returns: { "reply": "...", "tool_calls": [...], "session_id": "..." }
    """
    session = session_state.get_session(session_id)
    if session is None:
        return jsonify({"error": "Session not found"}), 404

    body = request.get_json(silent=True) or {}
    message = body.get("message", "").strip()
    if not message:
        return jsonify({"error": "message is required"}), 400

    provider_name = body.get("provider") or session.get("provider") or ""
    model = body.get("model") or session.get("model") or ""

    try:
        kwargs = {}
        if model:
            kwargs["model"] = model
        provider = get_provider(provider_name, **kwargs)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    try:
        result = run_turn(session_id, message, provider)
        return jsonify(result)
    except Exception as exc:
        logger.exception("Agent chat error")
        return jsonify({"error": str(exc)}), 500


@bp.route("/agent/sessions/<session_id>/chat/stream", methods=["GET"])
def chat_stream(session_id: str):
    """
    Streaming chat endpoint (Server-Sent Events).
    
    Query params: message=..., provider=...(optional), model=...(optional)
    
    Streams events:
      {"type":"tool_call", "tool":"...", "args":{...}}
      {"type":"tool_result", "tool":"...", "result":{...}}
      {"type":"reply_start"}
      {"type":"reply_chunk", "chunk":"..."}
      {"type":"reply_end", "session_id":"..."}
      {"type":"error", "message":"..."}
    """
    session = session_state.get_session(session_id)
    if session is None:
        def err():
            yield f'data: {json.dumps({"type":"error","message":"Session not found"})}\n\n'
        return Response(stream_with_context(err()), mimetype="text/event-stream")

    message = request.args.get("message", "").strip()
    if not message:
        def err():
            yield f'data: {json.dumps({"type":"error","message":"message query param is required"})}\n\n'
        return Response(stream_with_context(err()), mimetype="text/event-stream")

    provider_name = request.args.get("provider") or session.get("provider") or ""
    model = request.args.get("model") or session.get("model") or ""

    try:
        kwargs = {}
        if model:
            kwargs["model"] = model
        provider = get_provider(provider_name, **kwargs)
    except ValueError as exc:
        def err():
            yield f'data: {json.dumps({"type":"error","message":str(exc)})}\n\n'
        return Response(stream_with_context(err()), mimetype="text/event-stream")

    return Response(
        stream_with_context(run_turn_stream(session_id, message, provider)),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# Provider info
# ---------------------------------------------------------------------------

@bp.route("/agent/providers", methods=["GET"])
def providers():
    """List all supported LLM providers and their configuration status."""
    return jsonify({"providers": list_providers()})


@bp.route("/agent/health", methods=["GET"])
def agent_health():
    """Check if the configured LLM provider is reachable."""
    provider_name = request.args.get("provider", "")
    try:
        provider = get_provider(provider_name)
        result = provider.health_check()
        status_code = 200 if result["ok"] else 503
        return jsonify(result), status_code
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@bp.route("/agent/tools", methods=["GET"])
def list_tools():
    """Return the list of tools available to the agent."""
    tools = [
        {
            "name": t["function"]["name"],
            "description": t["function"]["description"],
            "parameters": list(t["function"]["parameters"].get("properties", {}).keys()),
        }
        for t in TOOL_SCHEMAS
    ]
    return jsonify({"tools": tools, "count": len(tools)})
