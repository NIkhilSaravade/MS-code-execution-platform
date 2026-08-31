import json
import re

from services.llm_provider import LLMProvider
from services.rag_service import RAGService
from prompts.passed_prompt import passed_prompt
from prompts.failed_prompt import failed_prompt


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
    def analyze(submission, problem):

        llm = LLMProvider.get_llm()

        # 🔥 Step 1: Retrieve context using RAG
        context_docs = rag_service.retrieve(problem["description"])
        context_text = "\n".join([doc.page_content for doc in context_docs])

        print("Retrieved Context:", context_text)

        # 🔥 Step 2: Choose prompt
        if submission["status"] == "PASSED":
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

        # 🔥 Step 3: Clean and parse JSON
        try:
            cleaned_json = AnalysisService.clean_llm_response(raw_text)
            parsed = json.loads(cleaned_json)

            return {
                "analysisType": parsed.get("analysisType"),
                "parsedAnalysis": parsed,
                "rawResponse": raw_text
            }

        except Exception as e:
            print("JSON Parse Failed:", e)

            return {
                "analysisType": "ERROR",
                "parsedAnalysis": None,
                "rawResponse": raw_text
            }