import os

# Must run before any project module is imported (conftest.py loads first).
# db/database.py raises at import time if DATABASE_URL is unset, but
# SQLAlchemy's create_engine is lazy - it never actually connects with these
# dummy values, so no live Postgres is needed to import/test the service.
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/test_ai_analysis_db")
os.environ.setdefault("AUTH_SERVICE_JWKS_URL", "http://localhost:9999/.well-known/jwks.json")

# Deliberately NOT stubbing GROQ_API_KEY here (a prior version of this file
# did, with a fake value). services/llm_provider.py's `load_dotenv()` call
# does NOT override an env var that's already set - so a fake value set
# here would silently shadow the real key .env provides, breaking any test
# that needs to make a real Groq call (e.g. tests/test_prompt_injection_live.py,
# tests/test_reranker.py's model download is unaffected since it doesn't
# call Groq). Confirmed as the actual cause of a real
# "Invalid API Key"/401 failure while adding Phase 4's live injection test,
# not assumed. Every other test in this suite mocks LLMProvider directly
# and never reaches this code path, so leaving GROQ_API_KEY unset here (and
# letting the real .env value flow through) doesn't affect them.
