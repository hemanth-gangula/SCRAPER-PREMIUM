"""Business records endpoints."""

import math
from flask import Blueprint, jsonify, request
from services.storage import iter_businesses, get_business

bp = Blueprint("businesses", __name__)


@bp.get("/businesses")
def list_all():
    page     = max(1, int(request.args.get("page", 1)))
    per_page = min(200, max(1, int(request.args.get("per_page", 50))))

    filters = {}
    for key in ("q", "country", "city", "state_region", "postal_code",
                "category", "source", "job_id"):
        val = request.args.get(key, "").strip()
        if val:
            filters[key] = val
    # Boolean filters
    for key in ("has_phone", "has_email", "has_website"):
        val = request.args.get(key)
        if val is not None:
            filters[key] = val.lower() == "true"
    if (mq := request.args.get("min_quality")):
        filters["min_quality"] = float(mq)

    items, total = iter_businesses(page=page, page_size=per_page, filters=filters if filters else None)
    return jsonify({
        "items":    items,
        "total":    total,
        "page":     page,
        "per_page": per_page,
        "pages":    math.ceil(total / per_page) if total else 0,
    })


@bp.get("/businesses/<biz_id>")
def get(biz_id):
    biz = get_business(biz_id)
    if not biz:
        return jsonify({"error": "Business not found"}), 404
    return jsonify(biz)
