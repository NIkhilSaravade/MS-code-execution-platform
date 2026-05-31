from sqlalchemy import Column, Integer, Text, DateTime
from datetime import datetime
from db.database import Base
from sqlalchemy import String

class AIAnalysis(Base):
    __tablename__ = "ai_analysis"

    id = Column(Integer, primary_key=True, index=True)
    submission_id = Column(Integer, index=True)
    problem_id = Column(Integer)
    user_id = Column(String)
    code = Column(Text)
    analysis = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)