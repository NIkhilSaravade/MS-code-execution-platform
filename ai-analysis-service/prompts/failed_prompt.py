from langchain_core.prompts import PromptTemplate

failed_prompt = PromptTemplate(
    input_variables=["problem", "code", "error"],
    template="""
You are a competitive programming mentor.

Problem:
{problem}

Code:
{code}

Error:
{error}

Return ONLY valid JSON in this format:

{{
    "analysisType": "FAILED",
    "failureReason": "...",
    "debuggingSuggestion": "...",
    "edgeCases": ["...", "..."],
    "hints": "..."
}}
"""
)