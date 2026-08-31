class AnalysisOutputInvalid(Exception):
    """Raised when the LLM's response doesn't validate against
    PassedAnalysis/FailedAnalysis (services/schemas.py) - either it wasn't
    valid JSON, or its shape didn't match the schema for the submission's
    verdict. Never cached (see services/analysis_pipeline.py) and turned into
    a 502 by POST /ai/analyze (main.py); the Kafka consumer already catches
    broad exceptions per-message, so it needs no special handling for this."""

    def __init__(self, message: str, raw_response: str):
        super().__init__(message)
        self.raw_response = raw_response
