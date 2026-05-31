import os
from langchain_groq import ChatGroq
from dotenv import load_dotenv

load_dotenv()

class LLMProvider:

    @staticmethod
    def get_llm():
        return ChatGroq(
            groq_api_key=os.getenv("GROQ_API_KEY"),
            model_name="llama-3.1-8b-instant",
            temperature=0.2
        )