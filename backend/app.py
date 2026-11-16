"""Flask application factory."""

import os
from pathlib import Path

# Set storage dir before any service imports
from config import config
os.environ.setdefault("SCRAPER_STORAGE_DIR", config.STORAGE_DIR)

from flask import Flask
from flask_cors import CORS

from services.jobs import recover_interrupted_jobs, set_dispatch_callback
from services.worker_client import dispatch_job


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["SECRET_KEY"] = config.SECRET_KEY
    app.config["DEBUG"] = config.DEBUG

    CORS(app, resources={r"/api/*": {"origins": config.CORS_ORIGINS}},
         supports_credentials=True)

    # Register blueprints
    from routes.health      import bp as health_bp
    from routes.dashboard   import bp as dashboard_bp
    from routes.jobs        import bp as jobs_bp
    from routes.businesses  import bp as businesses_bp
    from routes.exports     import bp as exports_bp
    from routes.schedules   import bp as schedules_bp
    from routes.settings    import bp as settings_bp
    from routes.logs        import bp as logs_bp
    from routes.backups     import bp as backups_bp
    from routes.sse         import bp as sse_bp
    from routes.enrichment  import bp as enrichment_bp
    from routes.auth        import bp as auth_bp
    from routes.agent       import bp as agent_bp

    for bp in [health_bp, dashboard_bp, jobs_bp, businesses_bp,
               exports_bp, schedules_bp, settings_bp, logs_bp,
               backups_bp, sse_bp, enrichment_bp, auth_bp, agent_bp]:
        app.register_blueprint(bp, url_prefix="/api")

    # Auth middleware — protects all /api/* routes except exempted ones
    from middleware.auth_middleware import check_auth
    app.before_request(check_auth)

    # Wire up dispatch callback (Flask calls Node worker)
    set_dispatch_callback(dispatch_job)

    # Start the schedule executor (cron runner)
    from services.scheduler import start_scheduler
    start_scheduler()

    # On startup, recover any interrupted jobs
    with app.app_context():
        recovered = recover_interrupted_jobs()
        if recovered:
            app.logger.info(f"Recovered {len(recovered)} interrupted jobs: {recovered}")

        # Pre-warm the dedup index cache so dashboard shows correct count immediately
        from services.dedup import _ensure_index
        _ensure_index()

    return app


if __name__ == "__main__":
    application = create_app()
    application.run(host="0.0.0.0", port=5000, debug=config.DEBUG, use_reloader=False)
