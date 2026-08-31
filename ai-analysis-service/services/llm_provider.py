import os
from langchain_groq import ChatGroq
from dotenv import load_dotenv

load_dotenv()

MODEL_NAME = "llama-3.1-8b-instant"


class LLMProvider:

    @staticmethod
    def get_llm():
        return ChatGroq(
            groq_api_key=os.getenv("GROQ_API_KEY"),
            model_name=MODEL_NAME,
            temperature=0.2
        )