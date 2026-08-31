import json
import re

from pydantic import ValidationError

from logging_config import get_logger
from services.exceptions import AnalysisOutputInvalid
from services.llm_provider import LLMProvider
from services.rag_service import RAGService
from services.schemas import FailedAnalysis, PassedAnalysis
from services.usage_tracker import record_usage
from prompts.passed_prompt import passed_prompt
from prompts.failed_prompt import failed_prompt

log = get_logger(__name__)

rag_service = RAGService()


class AnalysisService:

    @staticmethod
    def clean_llm_response(text: str) -> str:
        """
        Removes markdown code blocks and extracts JSON content.
        """

        # Remove ```json and ``` markers
        cleaned = re.sub(r"```json", "", text, flags=re.IGNORECASE)
        cleaned = re.sub(r"```", "", cleaned)

        # Extract JSON object only
        match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if match:
            return match.group(0)

        return cleaned.strip()

    @staticmethod
    def analyze(submission_id, submission, problem):

        # 🔥 Step 1: Retrieve context using RAG
        context_docs = rag_service.retrieve(problem["description"])
        context_text = "\n".join([doc.page_content for doc in context_docs])

        log.debug("analyze.rag_context_retrieved", submission_id=submission_id, context=context_text)

        # 🔥 Step 2: Render the prompt and call the LLM
        if submission["status"] == "PASSED":
            prompt_text = passed_prompt.format(
                problem=problem["description"] + "\n\nContext:\n" + context_text,
                code=submission["code"],
            )
        else:
            prompt_text = failed_prompt.format(
                problem=problem["description"] + "\n\nContext:\n" + context_text,
                code=submission["code"],
                error=submission.get("errorMessage", "Unknown error"),
            )

        response = LLMProvider.complete(prompt_text)
        raw_text = response.choices[0].message.content
        log.debug("analyze.llm_raw_output", submission_id=submission_id, raw_response=raw_text)

        # 🔥 Step 2.5: Record usage for every LLM call made, regardless of
        # whether its output later passes validation - the cost was
        # incurred either way. response.usage/.model reflect whichever
        # model actually answered (primary or litellm's fallback).
        usage = getattr(response, "usage", None)
        record_usage(
            user_id=submission["userId"],
            submission_id=submission_id,
            model=response.model,
            input_tokens=getattr(usage, "prompt_tokens", 0) or 0,
            output_tokens=getattr(usage, "completion_tokens", 0) or 0,
        )

        # 🔥 Step 3: Clean and strictly validate against the schema matching
        # this submission's verdict. Any failure here - not valid JSON, or
        # valid JSON that doesn't match the schema - is a hard error: the
        # caller decides what to do (POST /ai/analyze returns 502, the Kafka
        # consumer logs and drops the message), but this result is never
        # cached (see services/analysis_pipeline.py).
        schema = PassedAnalysis if submission["status"] == "PASSED" else FailedAnalysis

        try:
            cleaned_json = AnalysisService.clean_llm_response(raw_text)
            parsed = schema.model_validate_json(cleaned_json)
        except (json.JSONDecodeError, ValidationError) as e:
            log.warning(
                "analyze.output_invalid",
                submission_id=submission_id,
                schema=schema.__name__,
                error=str(e),
            )
            raise AnalysisOutputInvalid(
                f"LLM response failed {schema.__name__} validation: {e}",
                raw_response=raw_text,
            ) from e

        parsed_dict = parsed.model_dump()
        return {
            "analysisType": parsed_dict.get("analysisType"),
            "parsedAnalysis": parsed_dict,
            "rawResponse": raw_text
        }