import json
import re

from pydantic import ValidationError

from logging_config import get_logger
from services.agent_loop import SYSTEM_PROMPT, finalize_non_stream, finalize_stream, resolve_tool_calls
from services.critic_agent import critique
from services.exceptions import AnalysisOutputInvalid
from services.rag_service import get_rag_service
from services.redaction import redact_secrets
from services.schemas import FailedAnalysis, PassedAnalysis
from services.usage_tracker import record_usage
from prompts.passed_prompt import passed_prompt
from prompts.failed_prompt import failed_prompt

log = get_logger(__name__)


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
    def _build_messages(submission: dict, problem: dict) -> tuple[list[dict], str]:
        # Redact before anything else touches this code - before it goes
        # into the prompt, before any tool call built from the prompt can
        # see it, before it's logged anywhere. This is the one choke point
        # every path (Kafka-triggered and POST /ai/analyze[/stream]) goes
        # through, so a secret in submitted code never reaches Groq no
        # matter which entry point triggered the analysis.
        code, redacted_patterns = redact_secrets(submission["code"])
        if redacted_patterns:
            log.warning(
                "analyze.code_redacted",
                submissionId=submission.get("problemId"),
                patterns=sorted(set(redacted_patterns)),
            )

        context_docs = get_rag_service().retrieve(problem["description"])
        context_text = "\n".join(doc.page_content for doc in context_docs)

        if submission["status"] == "PASSED":
            prompt_text = passed_prompt.format(
                problem=problem["description"] + "\n\nContext:\n" + context_text,
                code=code,
            )
        else:
            prompt_text = failed_prompt.format(
                problem=problem["description"] + "\n\nContext:\n" + context_text,
                code=code,
                error=submission.get("errorMessage", "Unknown error"),
            )

        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt_text},
        ]
        return messages, code

    @staticmethod
    def _validate(submission: dict, raw_text: str):
        schema = PassedAnalysis if submission["status"] == "PASSED" else FailedAnalysis
        try:
            cleaned_json = AnalysisService.clean_llm_response(raw_text)
            parsed = schema.model_validate_json(cleaned_json)
        except (json.JSONDecodeError, ValidationError) as e:
            log.warning(
                "analyze.output_invalid",
                schema=schema.__name__,
                error=str(e),
            )
            raise AnalysisOutputInvalid(
                f"LLM response failed {schema.__name__} validation: {e}",
                raw_response=raw_text,
            ) from e
        return parsed

    @staticmethod
    def analyze(submission_id, submission, problem):
        """Non-streaming path - used by the Kafka consumer and as the
        cache-miss path underneath POST /ai/analyze. Runs the full
        tool-resolution loop, one final non-streaming completion, then
        Phase 5's critic/verifier pass (services/critic_agent.py) - a
        second, independent LLM call that can force one revision round
        before the result is returned. Not wired into analyze_stream() yet
        (see docs/ai-agent-build-log.md's Phase 5 entry) - only this
        non-streaming path gets a critic pass for now."""
        messages, redacted_code = AnalysisService._build_messages(submission, problem)

        tool_calls = resolve_tool_calls(messages)
        log.debug("analyze.tool_calls", submission_id=submission_id, count=len(tool_calls))

        response = finalize_non_stream(messages)
        raw_text = response.choices[0].message.content
        log.debug("analyze.llm_raw_output", submission_id=submission_id, raw_response=raw_text)

        usage = getattr(response, "usage", None)
        record_usage(
            user_id=submission["userId"],
            submission_id=submission_id,
            model=response.model,
            input_tokens=getattr(usage, "prompt_tokens", 0) or 0,
            output_tokens=getattr(usage, "completion_tokens", 0) or 0,
        )

        parsed = AnalysisService._validate(submission, raw_text)
        parsed_dict = parsed.model_dump()

        critic_verdict = critique(problem["description"], redacted_code, parsed_dict)
        revised = False
        if critic_verdict.needs_revision:
            log.info("analyze.critic_requested_revision", submission_id=submission_id, feedback=critic_verdict.feedback)
            messages.append({"role": "assistant", "content": raw_text})
            messages.append({
                "role": "user",
                "content": (
                    f"A reviewer flagged an issue with your draft: {critic_verdict.feedback}\n"
                    "Produce a corrected final JSON, same schema as before, addressing this."
                ),
            })
            revision_response = finalize_non_stream(messages)
            raw_text = revision_response.choices[0].message.content
            revision_usage = getattr(revision_response, "usage", None)
            record_usage(
                user_id=submission["userId"],
                submission_id=submission_id,
                model=revision_response.model,
                input_tokens=getattr(revision_usage, "prompt_tokens", 0) or 0,
                output_tokens=getattr(revision_usage, "completion_tokens", 0) or 0,
            )
            parsed = AnalysisService._validate(submission, raw_text)
            parsed_dict = parsed.model_dump()
            revised = True

        return {
            "analysisType": parsed_dict.get("analysisType"),
            "parsedAnalysis": parsed_dict,
            "rawResponse": raw_text,
            "toolCalls": tool_calls,
            "criticVerdict": critic_verdict.model_dump(),
            "revised": revised,
        }

    @staticmethod
    def analyze_stream(submission_id, submission, problem):
        """Streaming path - used by POST /ai/analyze/stream. A generator
        yielding dict events:
          {"type": "tool_call", "tool": ..., "args": ..., "result": ...}  (0+)
          {"type": "token", "content": "..."}                             (1+)
          {"type": "done", "result": {...same shape as analyze()...}}     (1, terminal)
          {"type": "error", "message": "..."}                             (terminal, on failure)
        Tool resolution itself is not streamed (see services/llm_provider.py's
        LLMProvider.stream docstring) - tool_call events are emitted as each
        tool finishes, before token streaming starts. Does NOT run Phase 5's
        critic pass (see analyze()'s docstring) - streaming already commits
        to showing the user tokens as they're generated, which doesn't
        compose cleanly with "the critic might throw this draft away and ask
        for a redo" without a more involved event protocol than this phase's
        scope covers; logged as a follow-up, not silently skipped."""
        messages, _redacted_code = AnalysisService._build_messages(submission, problem)

        tool_calls = resolve_tool_calls(messages)
        for call in tool_calls:
            yield {"type": "tool_call", **call}

        chunks: list[str] = []
        usage = None
        model_name = None
        for chunk in finalize_stream(messages):
            delta = chunk.choices[0].delta.content if chunk.choices else None
            if delta:
                chunks.append(delta)
                yield {"type": "token", "content": delta}
            if getattr(chunk, "usage", None):
                usage = chunk.usage
            if getattr(chunk, "model", None):
                model_name = chunk.model

        raw_text = "".join(chunks)
        log.debug("analyze_stream.llm_raw_output", submission_id=submission_id, raw_response=raw_text)

        record_usage(
            user_id=submission["userId"],
            submission_id=submission_id,
            model=model_name or "unknown",
            input_tokens=getattr(usage, "prompt_tokens", 0) or 0,
            output_tokens=getattr(usage, "completion_tokens", 0) or 0,
        )

        try:
            parsed = AnalysisService._validate(submission, raw_text)
        except AnalysisOutputInvalid as exc:
            yield {"type": "error", "message": str(exc)}
            return

        parsed_dict = parsed.model_dump()
        yield {
            "type": "done",
            "result": {
                "analysisType": parsed_dict.get("analysisType"),
                "parsedAnalysis": parsed_dict,
                "rawResponse": raw_text,
                "toolCalls": tool_calls,
            },
        }
