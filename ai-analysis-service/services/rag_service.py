from langchain_community.vectorstores import Chroma
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_core.documents import Document


class RAGService:

    def __init__(self):
        self.embedding = HuggingFaceEmbeddings(
            model_name="all-MiniLM-L6-v2"
        )

        self.vector_store = Chroma(
            collection_name="algo_knowledge",
            embedding_function=self.embedding,
            persist_directory="./chroma_db"
        )

    def add_documents(self, texts):
        docs = [Document(page_content=text) for text in texts]
        self.vector_store.add_documents(docs)

    def retrieve(self, query):
        return self.vector_store.similarity_search(query, k=3)