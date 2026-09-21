"""Cross-encoder reranking pass over hybrid_retrieve's merged candidates.

A cross-encoder scores (query, candidate) pairs jointly (unlike the
bi-encoder used for the vector store, which embeds query and candidate
independently), which is slower per-pair but meaningfully more accurate at
judging relevance - the standard "retrieve broad with a cheap method, then
rerank narrow with an expensive one" pattern. Only run over the top
candidate_k from hybrid_retrieve, not the whole corpus, since cross-encoder
scoring doesn't scale to full-corpus search.
"""

from sentence_transformers import CrossEncoder

from services.chunking import Chunk

_MODEL_NAME = "cross-encoder/ms-marco-MiniLM-L-6-v2"

_reranker_singleton: "CrossEncoder | None" = None


def get_reranker() -> CrossEncoder:
    global _reranker_singleton
    if _reranker_singleton is None:
        _reranker_singleton = CrossEncoder(_MODEL_NAME)
    return _reranker_singleton


def rerank(query: str, candidates: list[Chunk], top_k: int = 5) -> list[Chunk]:
    if not candidates:
        return []
    pairs = [(query, c.text) for c in candidates]
    scores = get_reranker().predict(pairs)
    ranked = sorted(zip(candidates, scores), key=lambda pair: pair[1], reverse=True)
    return [chunk for chunk, _score in ranked[:top_k]]
