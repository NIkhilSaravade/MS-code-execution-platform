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


class ExplanationGenerationFailed(Exception):
    """Raised when POST /ai/explain's LLM call comes back with an empty (or
    whitespace-only) response - explain has no JSON schema to validate
    against (see prompts/explain_prompt.py - it's free-form prose), so an
    empty string is the one shape of "this obviously didn't work" that's
    still cheap to check for. Never cached (see
    services/explanation_service.py::explain) and turned into a 502 by
    POST /ai/explain (main.py) - the same "don't silently serve a bad
    result forever" reasoning AnalysisOutputInvalid already applies to the
    review pipeline."""
