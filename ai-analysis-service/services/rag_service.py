import os

from dotenv import load_dotenv
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_community.vectorstores import PGVector
from langchain_core.documents import Document

load_dotenv()


def _pgvector_connection_string() -> str:
    # db/database.py's DATABASE_URL is a bare "postgresql://..." SQLAlchemy
    # URL (defaults to the psycopg2 dialect); PGVector wants that dialect
    # spelled out explicitly. sslmode/sslrootcert query params carry over
    # unchanged - this cluster requires TLS (see CLAUDE.md).
    database_url = os.environ["DATABASE_URL"]
    if database_url.startswith("postgresql://"):
        return database_url.replace("postgresql://", "postgresql+psycopg2://", 1)
    return database_url


class RAGService:

    def __init__(self):
        self.embedding = HuggingFaceEmbeddings(
            model_name="all-MiniLM-L6-v2"
        )

        # Shared, Postgres-backed index (pgvector) instead of a local
        # ./chroma_db directory - every replica of this service reads/writes
        # the same index now, rather than each pod getting its own private
        # one (see infra/postgres/init-multiple-databases.sh's
        # CREATE EXTENSION vector for ai_analysis_db).
        self.vector_store = PGVector(
            connection_string=_pgvector_connection_string(),
            embedding_function=self.embedding,
            collection_name="algo_knowledge",
            use_jsonb=True,
        )

    def add_documents(self, texts):
        docs = [Document(page_content=text) for text in texts]
        self.vector_store.add_documents(docs)

    def retrieve(self, query):
        return self.vector_store.similarity_search(query, k=3)
