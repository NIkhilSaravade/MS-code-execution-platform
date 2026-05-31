from services.rag_service import RAGService

rag = RAGService()

knowledge = [
    "Time complexity of sorting using quicksort is O(n log n) average case.",
    "HashMap allows O(1) average lookup time.",
    "Binary search works only on sorted arrays.",
    "Edge cases often include empty arrays and single element arrays.",
    "Recursion depth can cause stack overflow if not controlled."
]

rag.add_documents(knowledge)

print("Knowledge base seeded successfully.")