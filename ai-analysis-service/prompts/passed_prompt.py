from langchain_core.prompts import PromptTemplate

passed_prompt = PromptTemplate(
    input_variables=["problem", "code"],
    template="""
You are a senior software engineer reviewing a correct solution.

Problem:
{problem}

Code:
{code}

Return ONLY valid JSON in this format:

{{
    "analysisType": "PASSED",
    "timeComplexity": "...",
    "spaceComplexity": "...",
    "optimizationSuggestions": "...",
    "codeSmells": "...",
    "alternativeApproach": "..."
}}
"""
)