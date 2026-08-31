from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
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
