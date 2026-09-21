"""Uses the real cross-encoder model (network required on first run to
download weights to the local HuggingFace cache; cached afterward). Not
mocked - Phase 2's Done-when explicitly asks for a real reranking pass."""

from services.chunking import Chunk
from services.reranker import rerank

CANDIDATES = [
    Chunk(text="Kafka topic partitioning strategy for the submission pipeline.", source="a.md", kind="prose", title="kafka"),
    Chunk(text="Using eval() on untrusted user input allows arbitrary code execution.", source="b.md", kind="prose", title="eval-security"),
    Chunk(text="MinIO bucket lifecycle policy configuration.", source="c.md", kind="prose", title="minio"),
]


def test_rerank_orders_most_relevant_candidate_first():
    results = rerank("is it safe to call eval on user-submitted code", CANDIDATES, top_k=3)
    assert results[0].title == "eval-security"


def test_rerank_empty_candidates_returns_empty():
    assert rerank("anything", [], top_k=3) == []
