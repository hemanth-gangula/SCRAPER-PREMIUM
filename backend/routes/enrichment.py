"""
AI enrichment endpoint — uses Groq LLM to fill in missing business data
(email guesses, short description, open/closed status).

Requires GROQ_API_KEY in .env. Falls back gracefully if not configured.
"""

import json
import requests
from flask import Blueprint, jsonify
from services.storage import get_business, update_business, append_activity
from config import config

bp = Blueprint("enrichment", __name__)

_GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"


def _groq_request(prompt: str) -> str | None:
    if not config.GROQ_API_KEY:
        return None
    try:
        resp = requests.post(
            _GROQ_URL,
            headers={
                "Authorization": f"Bearer {config.GROQ_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": config.GROQ_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 256,
                "temperature": 0.3,
            },
            timeout=15,
        )
        if resp.status_code == 200:
            return resp.json()["choices"][0]["message"]["content"].strip()
    except Exception:
        pass
    return None


def _build_prompt(biz: dict) -> str:
    name    = biz.get("name", "Unknown")
    cat     = biz.get("category", "")
    city    = biz.get("city", "")
    country = biz.get("country", "")
    website = biz.get("website", "")
    phone   = biz.get("phone", "")

    return (
        f"You are a business data assistant. Given this business:\n"
        f"  Name:     {name}\n"
        f"  Category: {cat}\n"
        f"  Location: {city}, {country}\n"
        f"  Website:  {website or 'unknown'}\n"
        f"  Phone:    {phone or 'unknown'}\n\n"
        f"Return a JSON object with these keys only:\n"
        f"  description: a 1-sentence professional description of this type of business (max 120 chars)\n"
        f"  email_guess: a plausible contact email based on the website domain, or null if no website\n"
        f"  tags: array of 3 relevant keyword strings\n\n"
        f"Respond ONLY with valid JSON. No markdown, no explanation."
    )


@bp.post("/businesses/<biz_id>/enrich")
def enrich(biz_id: str):
    biz = get_business(biz_id)
    if not biz:
        return jsonify({"error": "Business not found"}), 404

    if not config.GROQ_API_KEY:
        return jsonify({"error": "GROQ_API_KEY not configured"}), 503

    # Skip if already enriched recently
    if biz.get("ai_enriched") and biz.get("description") and biz.get("tags"):
        return jsonify({"status": "skipped", "reason": "already enriched", "business": biz})

    prompt   = _build_prompt(biz)
    raw_text = _groq_request(prompt)

    if not raw_text:
        return jsonify({"error": "Groq API call failed or timed out"}), 502

    # Parse LLM JSON output
    try:
        # Strip markdown fences if LLM adds them
        text = raw_text.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        enriched = json.loads(text)
    except json.JSONDecodeError:
        return jsonify({"error": "LLM returned invalid JSON", "raw": raw_text}), 502

    updates: dict = {"ai_enriched": True}

    if enriched.get("description"):
        updates["description"] = str(enriched["description"])[:200]

    # Only fill email if it's currently missing
    if not biz.get("email") and enriched.get("email_guess"):
        updates["email_guess"] = str(enriched["email_guess"])

    if enriched.get("tags") and isinstance(enriched["tags"], list):
        updates["tags"] = [str(t) for t in enriched["tags"][:5]]

    updated = update_business(biz_id, updates)
    append_activity(
        biz.get("job_id", biz_id),
        "ai_enriched",
        f"AI enriched: {biz.get('name')}",
        {"business_id": biz_id},
    )

    return jsonify({"status": "ok", "business": updated})
