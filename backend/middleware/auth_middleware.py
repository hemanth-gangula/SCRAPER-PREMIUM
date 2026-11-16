"""
Flask before_request middleware that enforces auth on all /api/* routes
except the public ones listed in EXEMPT_PATHS.
"""

from flask import request, jsonify
from routes.auth import verify_token, _COOKIE_NAME
from config import config

EXEMPT_PATHS = {
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/me",
    "/api/health",          # health checks must be unauthenticated for uptime monitors
}


def check_auth():
    """Called via app.before_request."""
    path = request.path

    # Only protect /api/* routes
    if not path.startswith("/api/"):
        return None

    # Public endpoints
    if path in EXEMPT_PATHS:
        return None

    # If no password set, skip auth entirely (open dev mode)
    if not config.ADMIN_PASSWORD or config.ADMIN_PASSWORD in ("", "changeme"):
        return None

    token = request.cookies.get(_COOKIE_NAME)
    if token and verify_token(token):
        return None

    return jsonify({"error": "Unauthorized", "login_required": True}), 401
