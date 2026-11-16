"""
Real-Time Global Deduplication & Auto-Skip.

Matching tiers (strongest first):
  1. Stable source ID / Place ID
  2. Canonicalized source URL
  3. Normalized phone number
  4. Normalized website domain
  5. Normalized name + normalized address (fallback only)

Index is persisted to storage/deduplication/index.json after each change.
Thread-safe for concurrent jobs.
"""

import re
import threading
from typing import Optional
from urllib.parse import urlparse
from unicodedata import normalize as unorm

from .storage import load_dedup_index, save_dedup_index

_lock = threading.Lock()
_index: Optional[dict] = None  # { fingerprint: business_id }


def _ensure_index() -> dict:
    global _index
    if _index is None:
        _index = load_dedup_index()
    return _index


def _save() -> None:
    global _index
    save_dedup_index(_index or {})


# ── Normalization ─────────────────────────────────────────────────────────────

_LEGAL = re.compile(
    r"\b(llc|ltd|inc|corp|co\.?|company|plc|gmbh|bv|sa|srl|pty|pvt|the)\b",
    re.IGNORECASE,
)
_WHITESPACE = re.compile(r"\s+")
_NON_ALPHA = re.compile(r"[^a-z0-9 ]")


def _norm_text(s: str) -> str:
    if not s:
        return ""
    s = unorm("NFKD", s).encode("ascii", "ignore").decode()
    s = s.lower()
    # Strip possessives before removing apostrophes so "joe's" → "joes"
    s = re.sub(r"'s\b", "s", s)
    s = re.sub(r"'\b|\b'", "", s)  # remove remaining apostrophes
    s = _LEGAL.sub("", s)
    s = _NON_ALPHA.sub(" ", s)
    return _WHITESPACE.sub(" ", s).strip()


def _norm_phone(phone: str) -> Optional[str]:
    digits = re.sub(r"\D", "", phone or "")
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    return digits if len(digits) >= 7 else None


def _norm_domain(url: str) -> Optional[str]:
    try:
        if "://" not in url:
            url = "http://" + url
        host = urlparse(url).hostname or ""
        host = host.lower().strip()
        if host.startswith("www."):
            host = host[4:]
        return host or None
    except Exception:
        return None


def _norm_address(street: str, city: str, postal: str) -> str:
    parts = [_norm_text(p) for p in (street, city, postal) if p]
    return " ".join(parts)


# ── Fingerprint builders ──────────────────────────────────────────────────────

def fingerprints(record: dict) -> list[tuple[str, str]]:
    """
    Return a list of (tier_key, fingerprint_value) for the record.
    Checked in order — first match wins.
    """
    fps = []
    # Tier 1: source id / place id
    for field in ("place_id", "source_id", "maps_place_id"):
        val = str(record.get(field) or "").strip()
        if val and val != "None":
            fps.append(("place_id", val))
            break

    # Tier 2: canonical source url
    src_url = str(record.get("source_url") or "").strip()
    if src_url:
        fps.append(("source_url", src_url.lower()))

    # Tier 3: phone
    pn = _norm_phone(str(record.get("phone") or ""))
    if pn:
        fps.append(("phone", pn))

    # Tier 4: domain
    dom = _norm_domain(str(record.get("website") or ""))
    if dom:
        fps.append(("domain", dom))

    # Tier 5: name + address (only when strong enough)
    name_n = _norm_text(str(record.get("name") or ""))
    addr_n = _norm_address(
        str(record.get("street_address") or ""),
        str(record.get("city") or ""),
        str(record.get("postal_code") or ""),
    )
    if name_n and addr_n:
        fps.append(("name_addr", f"{name_n}||{addr_n}"))

    return fps


# ── Public API ────────────────────────────────────────────────────────────────

class DedupResult:
    def __init__(
        self,
        is_duplicate: bool = False,
        existing_id: Optional[str] = None,
        match_tier: Optional[str] = None,
        match_fingerprint: Optional[str] = None,
    ):
        self.is_duplicate = is_duplicate
        self.existing_id = existing_id
        self.match_tier = match_tier
        self.match_fingerprint = match_fingerprint

    @property
    def is_new(self) -> bool:
        return not self.is_duplicate


def check(record: dict) -> DedupResult:
    """Thread-safe duplicate check. Does NOT modify the index."""
    with _lock:
        idx = _ensure_index()
        for tier, fp in fingerprints(record):
            key = f"{tier}:{fp}"
            if key in idx:
                return DedupResult(
                    is_duplicate=True,
                    existing_id=idx[key],
                    match_tier=tier,
                    match_fingerprint=fp,
                )
    return DedupResult(is_duplicate=False)


def register(record: dict, business_id: str) -> None:
    """Register all fingerprints for a newly saved business."""
    with _lock:
        global _index
        idx = _ensure_index()
        for tier, fp in fingerprints(record):
            key = f"{tier}:{fp}"
            idx.setdefault(key, business_id)
        _save()


def remove(business_id: str) -> None:
    """Remove all fingerprints for a business (for testing / admin)."""
    with _lock:
        global _index
        idx = _ensure_index()
        keys_to_remove = [k for k, v in idx.items() if v == business_id]
        for k in keys_to_remove:
            del idx[k]
        _save()


def index_stats() -> dict:
    with _lock:
        idx = _ensure_index()   # always load from disk if cache is cold
    tiers: dict[str, int] = {}
    for key in idx:
        tier = key.split(":")[0]
        tiers[tier] = tiers.get(tier, 0) + 1
    return {"total_fingerprints": len(idx), "by_tier": tiers}
