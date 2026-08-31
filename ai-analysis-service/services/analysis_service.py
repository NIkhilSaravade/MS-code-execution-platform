import json
import re

from pydantic import ValidationError

from services.llm_provider import LLMProvider
from services.rag_service import RAGService
from services.schemas import FailedAnalysis, PassedAnalysis
from prompts.passed_prompt import passed_prompt
from prompts.failed_prompt import failed_prompt


rag_service = RAGService()


class AnalysisOutputInvalid(Exception):
    """Raised when the LLM's response isn't valid JSON or doesn't match the
    schema expected for the submission's verdict. Callers must not cache a
    result when this is raised - a "fixed" malformed analysis is worse than
    no analysis (main.py surfaces this as a 502; kafka/consumer.py's
    best-effort handling logs it and drops the message rather than caching
    a broken result)."""


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
    def analyze(submission, problem):

        llm = LLMProvider.get_llm()

        # 🔥 Step 1: Retrieve context using RAG
        context_docs = rag_service.retrieve(problem["description"])
        context_text = "\n".join([doc.page_content for doc in context_docs])

        print("Retrieved Context:", context_text)

        # 🔥 Step 2: Choose prompt
        is_passed = submission["status"] == "PASSED"
        if is_passed:
            chain = passed_prompt | llm
            response = chain.invoke({
                "problem": problem["description"] + "\n\nContext:\n" + context_text,
                "code": submission["code"]
            })
        else:
            chain = failed_prompt | llm
            response = chain.invoke({
                "problem": problem["description"] + "\n\nContext:\n" + context_text,
                "code": submission["code"],
                "error": submission.get("errorMessage", "Unknown error")
            })

        raw_text = response.content
        print("Raw LLM Output:", raw_text)

        # 🔥 Step 3: Clean, parse and strictly validate against the schema for
        # this verdict. A response that isn't JSON or doesn't match the
        # schema is never silently accepted - see AnalysisOutputInvalid.
        try:
            cleaned_json = AnalysisService.clean_llm_response(raw_text)
            parsed = json.loads(cleaned_json)
        except json.JSONDecodeError as exc:
            raise AnalysisOutputInvalid(f"LLM response was not valid JSON: {exc}") from exc

        schema = PassedAnalysis if is_passed else FailedAnalysis
        try:
            validated = schema.model_validate(parsed)
        except ValidationError as exc:
            raise AnalysisOutputInvalid(f"LLM response failed schema validation: {exc}") from exc

        return {
            "analysisType": validated.analysisType,
            "parsedAnalysis": validated.model_dump(),
            "rawResponse": raw_text,
        }
