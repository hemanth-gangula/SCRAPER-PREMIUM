"""Excel, CSV, and JSON export generation."""

import csv
import io
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment
import xlsxwriter

EXPORT_COLUMNS = [
    ("id",              "ID"),
    ("name",            "Business Name"),
    ("category",        "Category"),
    ("street_address",  "Street Address"),
    ("city",            "City"),
    ("state_region",    "State/Region"),
    ("postal_code",     "Postal Code"),
    ("country",         "Country"),
    ("phone",           "Phone"),
    ("email",           "Email"),
    ("website",         "Website"),
    ("rating",          "Rating"),
    ("review_count",    "Review Count"),
    ("price_level",     "Price Level"),
    ("maps_url",        "Google Maps URL"),
    ("place_id",        "Place ID"),
    ("latitude",        "Latitude"),
    ("longitude",       "Longitude"),
    ("quality_score",   "Quality Score"),
    ("source",          "Source"),
    ("source_url",      "Source URL"),
    ("job_id",          "Job ID"),
    ("first_seen_at",   "First Seen"),
    ("last_scraped_at", "Last Scraped"),
]


def _safe(v) -> str:
    """Escape formula injection in spreadsheet cells."""
    s = "" if v is None else str(v)
    if s and s[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + s
    return s


def export_csv(records: list[dict]) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([col[1] for col in EXPORT_COLUMNS])
    for rec in records:
        writer.writerow([_safe(rec.get(col[0], "")) for col in EXPORT_COLUMNS])
    return ("\ufeff" + buf.getvalue()).encode("utf-8")


def export_xlsx(records: list[dict]) -> bytes:
    buf = io.BytesIO()
    wb = xlsxwriter.Workbook(buf, {"in_memory": True})
    ws = wb.add_worksheet("Businesses")
    summary = wb.add_worksheet("Summary")

    hdr_fmt = wb.add_format({"bold": True, "bg_color": "#1E293B",
                              "font_color": "#FFFFFF", "border": 1})
    cell_fmt = wb.add_format({"border": 1, "text_wrap": False})
    url_fmt  = wb.add_format({"border": 1, "font_color": "#3B82F6", "underline": True})

    # Headers
    for col_i, (_, header) in enumerate(EXPORT_COLUMNS):
        ws.write(0, col_i, header, hdr_fmt)

    # Rows
    for row_i, rec in enumerate(records, start=1):
        for col_i, (key, _) in enumerate(EXPORT_COLUMNS):
            val = rec.get(key, "") or ""
            if key in ("website", "maps_url", "source_url") and str(val).startswith("http"):
                ws.write_url(row_i, col_i, val, url_fmt, str(val)[:50])
            else:
                ws.write(row_i, col_i, _safe(val), cell_fmt)

    # Column widths
    ws.freeze_panes(1, 0)
    ws.autofilter(0, 0, len(records), len(EXPORT_COLUMNS) - 1)
    for col_i, (_, header) in enumerate(EXPORT_COLUMNS):
        max_w = max(len(header),
                    *[len(str(r.get(EXPORT_COLUMNS[col_i][0], "") or ""))
                      for r in records[:200]], 0)
        ws.set_column(col_i, col_i, min(max_w + 2, 60))

    # Summary sheet
    summary.write(0, 0, "Export Summary", wb.add_format({"bold": True, "font_size": 14}))
    ts = datetime.now(timezone.utc).isoformat()
    for row_i, (label, value) in enumerate([
        ("Total businesses", len(records)),
        ("Exported at (UTC)", ts),
        ("Columns", len(EXPORT_COLUMNS)),
    ], start=2):
        summary.write(row_i, 0, label)
        summary.write(row_i, 1, value)

    wb.close()
    return buf.getvalue()


def export_json(records: list[dict]) -> bytes:
    output = [{col[0]: rec.get(col[0]) for col in EXPORT_COLUMNS} for rec in records]
    return json.dumps(output, ensure_ascii=False, indent=2, default=str).encode("utf-8")


def save_export(content: bytes, fmt: str, label: str = "") -> str:
    """Save export to storage/exports/ and return filename."""
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    fname = f"export_{ts}{'_'+label if label else ''}.{fmt}"
    exports_dir = Path(os.environ.get("SCRAPER_STORAGE_DIR", "./storage")) / "exports"
    exports_dir.mkdir(parents=True, exist_ok=True)
    (exports_dir / fname).write_bytes(content)
    return fname
