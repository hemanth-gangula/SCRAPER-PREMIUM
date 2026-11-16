"""
Authentication endpoints.

Strategy: single admin password stored in .env (ADMIN_PASSWORD).
On successful login the server issues a signed JWT stored as an
HttpOnly cookie. All /api/* routes (except /api/health and /api/auth/*)
require the cookie.

JWT is signed with the app SECRET_KEY using HS256.
No database required — stateless.
"""

import hmac
import hashlib
import time
import json
import base64
from functools import wraps
from flask import Blueprint, request, jsonify, make_response, g
from config import config

bp = Blueprint("auth", __name__)

_COOKIE_NAME = "sp_token"
_TOKEN_TTL   = 60 * 60 * 12  # 12 hours


# ── JWT (minimal — no external library needed) ────────────────────────────────

def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _sign(header_b64: str, payload_b64: str) -> str:
    msg = f"{header_b64}.{payload_b64}".encode()
    sig = hmac.new(config.SECRET_KEY.encode(), msg, hashlib.sha256).digest()
    return _b64url(sig)


def create_token() -> str:
    header  = _b64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = _b64url(json.dumps({"sub": "admin", "iat": int(time.time()),
                                   "exp": int(time.time()) + _TOKEN_TTL}).encode())
    sig = _sign(header, payload)
    return f"{header}.{payload}.{sig}"


def verify_token(token: str) -> bool:
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return False
        header, payload, sig = parts
        if not hmac.compare_digest(sig, _sign(header, payload)):
            return False
        # Decode payload
        pad = 4 - len(payload) % 4
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * pad))
        return claims.get("exp", 0) > time.time()
    except Exception:
        return False


# ── Decorator ─────────────────────────────────────────────────────────────────

def require_auth(f):
    """Decorator — apply to any blueprint that needs authentication."""
    @wraps(f)
    def decorated(*args, **kwargs):
        # Skip auth if no password is configured (open dev mode)
        if not config.ADMIN_PASSWORD or config.ADMIN_PASSWORD == "":
            return f(*args, **kwargs)
        token = request.cookies.get(_COOKIE_NAME)
        if not token or not verify_token(token):
            return jsonify({"error": "Unauthorized", "login_required": True}), 401
        return f(*args, **kwargs)
    return decorated


# ── Routes ────────────────────────────────────────────────────────────────────

@bp.post("/auth/login")
def login():
    data = request.get_json(force=True, silent=True) or {}
    password = data.get("password", "")
    if not hmac.compare_digest(password, config.ADMIN_PASSWORD):
        return jsonify({"error": "Invalid password"}), 401
    token = create_token()
    resp  = make_response(jsonify({"ok": True}))
    resp.set_cookie(
        _COOKIE_NAME, token,
        httponly=True,
        samesite="Lax",
        secure=False,         # set to True behind HTTPS
        max_age=_TOKEN_TTL,
        path="/",
    )
    return resp


@bp.post("/auth/logout")
def logout():
    resp = make_response(jsonify({"ok": True}))
    resp.delete_cookie(_COOKIE_NAME, path="/")
    return resp


@bp.get("/auth/me")
def me():
    token = request.cookies.get(_COOKIE_NAME)
    if token and verify_token(token):
        return jsonify({"authenticated": True, "user": "admin"})
    return jsonify({"authenticated": False}), 401
