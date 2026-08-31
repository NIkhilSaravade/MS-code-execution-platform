from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text

from db.database import Base


class AnalysisCache(Base):
    """Content-addressed cache: one row per unique (problem_id, normalized
    code) pair. Submissions with identical code share this row instead of
    each paying for their own LLM call - see SubmissionAnalysisMap for the
    submission_id -> cache_key lookup."""

    __tablename__ = "analysis_cache"

    cache_key = Column(String(64), primary_key=True)
    problem_id = Column(Integer, index=True, nullable=False)
    analysis_type = Column(String(20), nullable=False)
    analysis = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class SubmissionAnalysisMap(Base):
    """Lookup from a concrete submission_id (what callers actually have) to
    the shared AnalysisCache row, so GET /ai/analysis/{submission_id} stays
    a single indexed lookup. Also carries user_id for the ownership check in
    main.py's GET /ai/analysis/{submission_id}."""

    __tablename__ = "submission_analysis_map"

    submission_id = Column(Integer, primary_key=True)
    cache_key = Column(String(64), ForeignKey("analysis_cache.cache_key"), nullable=False, index=True)
    user_id = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
