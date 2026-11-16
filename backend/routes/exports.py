"""Export endpoints — Excel, CSV, JSON."""

from flask import Blueprint, jsonify, request, Response, send_file
from services.storage import iter_businesses
from services.exports import export_csv, export_xlsx, export_json, save_export

bp = Blueprint("exports", __name__)


def _get_records(args):
    """Build records list from query params."""
    filters = {}
    for key in ("q", "country", "city", "category", "job_id"):
        val = args.get(key, "").strip()
        if val:
            filters[key] = val
    # Up to 50k records
    items, _ = iter_businesses(page=1, page_size=50000, filters=filters or None)
    return items


@bp.get("/exports/csv")
def export_csv_endpoint():
    records = _get_records(request.args)
    data = export_csv(records)
    return Response(data, mimetype="text/csv",
                    headers={"Content-Disposition": "attachment; filename=scraper_premium.csv"})


@bp.get("/exports/xlsx")
def export_xlsx_endpoint():
    records = _get_records(request.args)
    data = export_xlsx(records)
    mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    return Response(data, mimetype=mime,
                    headers={"Content-Disposition": "attachment; filename=scraper_premium.xlsx"})


@bp.get("/exports/json")
def export_json_endpoint():
    records = _get_records(request.args)
    data = export_json(records)
    return Response(data, mimetype="application/json",
                    headers={"Content-Disposition": "attachment; filename=scraper_premium.json"})
