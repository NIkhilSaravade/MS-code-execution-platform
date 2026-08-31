from sqlalchemy import Column, Integer, String, Text, DateTime, Float, ForeignKey
from datetime import datetime
from db.database import Base


class AnalysisCache(Base):
    """Content-addressed cache: one row per distinct (problem_id, normalized
    code) pair, regardless of how many submissions share that exact code -
    see services/analysis_pipeline.py's _cache_key. cache_key is
    sha256(problem_id + normalized_code)."""

    __tablename__ = "analysis_cache"

    cache_key = Column(String(64), primary_key=True)
    problem_id = Column(Integer, index=True, nullable=False)
    analysis_type = Column(String(16), nullable=False)
    raw_response = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class ProcessedEvent(Base):
    """Idempotency record for kafka/consumer.py's analysis.trigger.v1
    pipeline (main topic + its delayed-retry topics + DLQ - see that
    module). Manual offset commits mean a crash between "handled" and
    "committed" can redeliver a message; this table lets the consumer
    recognize and skip an event it already finished, instead of relying
    solely on analysis_pipeline's own submission_id cache (which only
    dedupes the LLM call, not the whole handling path including
    fetch-from-upstream)."""

    __tablename__ = "processed_events"

    event_key = Column(String(128), primary_key=True)
    processed_at = Column(DateTime, default=datetime.utcnow)


class UsageLedger(Base):
    """One row per LLM call made in services/analysis_service.py - a
    prerequisite for any future per-user budget/kill-switch work (not
    implemented here, just the tracking). Recorded for every call
    regardless of whether its output later passes strict validation, since
    the cost was incurred either way."""

    __tablename__ = "usage_ledger"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, index=True, nullable=False)
    submission_id = Column(Integer, index=True, nullable=False)
    model = Column(String(64), nullable=False)
    input_tokens = Column(Integer, nullable=False, default=0)
    output_tokens = Column(Integer, nullable=False, default=0)
    estimated_cost_usd = Column(Float, nullable=False, default=0.0)
    created_at = Column(DateTime, default=datetime.utcnow)


class SubmissionAnalysisMap(Base):
    """Maps a submission_id to the AnalysisCache row that answers it. Kept
    separate from AnalysisCache so GET /ai/analysis/{submission_id}'s
    ownership check (userId must match the caller) stays per-submission even
    though the underlying analysis is shared across submissions."""

    __tablename__ = "submission_analysis_map"

    submission_id = Column(Integer, primary_key=True)
    cache_key = Column(String(64), ForeignKey("analysis_cache.cache_key"), nullable=False, index=True)
    user_id = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
