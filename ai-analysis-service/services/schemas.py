from pydantic import BaseModel
from typing import List

class PassedAnalysis(BaseModel):
    analysisType: str
    timeComplexity: str
    spaceComplexity: str
    optimizationSuggestions: str
    codeSmells: str
    alternativeApproach: str

class FailedAnalysis(BaseModel):
    analysisType: str
    failureReason: str
    debuggingSuggestion: str
    edgeCases: List[str]
    hints: str