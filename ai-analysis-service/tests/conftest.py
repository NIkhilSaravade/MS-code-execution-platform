import os

# Must run before any project module is imported (conftest.py loads first).
# db/database.py raises at import time if DATABASE_URL is unset, but
# SQLAlchemy's create_engine is lazy - it never actually connects with these
# dummy values, so no live Postgres is needed to import/test the service.
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/test_ai_analysis_db")
os.environ.setdefault("AUTH_SERVICE_JWKS_URL", "http://localhost:9999/.well-known/jwks.json")
os.environ.setdefault("GROQ_API_KEY", "test-key-not-real")
