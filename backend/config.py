"""Backend configuration."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
_dotenv = ROOT / ".env"
if _dotenv.exists():
    from dotenv import load_dotenv
    load_dotenv(_dotenv, override=False)


class Config:
    SECRET_KEY:          str  = os.getenv("SECRET_KEY", "dev-secret-change-me")
    FLASK_ENV:           str  = os.getenv("FLASK_ENV", "development")
    DEBUG:               bool = os.getenv("FLASK_DEBUG", "true").lower() == "true"
    CORS_ORIGINS:        list = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:3001").split(",")]
    STORAGE_DIR:         str  = os.getenv("SCRAPER_STORAGE_DIR", str(ROOT / "storage"))
    WORKER_PORT:         int  = int(os.getenv("SCRAPER_WORKER_PORT", 4001))
    WORKER_TOKEN:        str  = os.getenv("SCRAPER_WORKER_TOKEN", "dev-token")
    DEFAULT_DAILY_LIMIT: int  = int(os.getenv("DEFAULT_DAILY_LIMIT", 500))
    DEFAULT_JOB_LIMIT:   int  = int(os.getenv("DEFAULT_JOB_LIMIT",   100))
    MAX_CONCURRENT_JOBS: int  = int(os.getenv("MAX_CONCURRENT_JOBS",  2))
    GROQ_API_KEY:        str  = os.getenv("GROQ_API_KEY", "")
    GROQ_MODEL:          str  = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")
    # AI Agent settings
    LLM_PROVIDER:        str  = os.getenv("LLM_PROVIDER", "")       # groq|openai|anthropic|local|mock
    OPENAI_API_KEY:      str  = os.getenv("OPENAI_API_KEY", "")
    OPENAI_MODEL:        str  = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    ANTHROPIC_API_KEY:   str  = os.getenv("ANTHROPIC_API_KEY", "")
    ANTHROPIC_MODEL:     str  = os.getenv("ANTHROPIC_MODEL", "claude-3-haiku-20240307")
    LOCAL_LLM_URL:       str  = os.getenv("LOCAL_LLM_URL", "http://localhost:11434/v1")
    LOCAL_LLM_MODEL:     str  = os.getenv("LOCAL_LLM_MODEL", "llama3")
    ADMIN_PASSWORD:      str  = os.getenv("ADMIN_PASSWORD", "changeme")


config = Config()
