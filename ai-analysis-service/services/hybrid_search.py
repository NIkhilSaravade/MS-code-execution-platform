"""Hybrid retrieval: combines the existing PGVector semantic search
(services/rag_service.py) with a lexical BM25 pass over the same corpus
(services/corpus.py), merged via Reciprocal Rank Fusion (RRF) - standard,
simple, and doesn't require calibrating two different similarity scales
against each other (RRF only needs each side's *rank ordering*, not
comparable score magnitudes, which vector cosine-similarity and BM25 scores
are not).

Code review needs both: semantic search finds conceptually related material
even when the wording differs ("off-by-one" vs "boundary condition"), while
BM25 finds exact symbol/keyword matches semantic search can miss or dilute
(a query containing `strcpy` should surface the chunk that says `strcpy`,
even if some other chunk is a closer semantic match overall).
"""

from collections import defaultdict
from typing import Callable

from rank_bm25 import BM25Okapi

from services.chunking import Chunk
from services.corpus import load_corpus

RRF_K = 60  # standard RRF damping constant


def _tokenize(text: str) -> list[str]:
    return [t.lower() for t in text.replace("`", " ").split() if t.isalnum() or any(c.isalnum() for c in t)]


class BM25Index:
    def __init__(self, chunks: list[Chunk]):
        self.chunks = chunks
        self._tokenized = [_tokenize(c.text) for c in chunks]
        self._bm25 = BM25Okapi(self._tokenized) if self._tokenized else None

    def search(self, query: str, k: int = 10) -> list[Chunk]:
        if self._bm25 is None:
            return []
        scores = self._bm25.get_scores(_tokenize(query))
        ranked = sorted(range(len(self.chunks)), key=lambda i: scores[i], reverse=True)
        return [self.chunks[i] for i in ranked[:k] if scores[i] > 0]


_bm25_index_singleton: "BM25Index | None" = None


def get_bm25_index() -> BM25Index:
    global _bm25_index_singleton
    if _bm25_index_singleton is None:
        _bm25_index_singleton = BM25Index(load_corpus())
    return _bm25_index_singleton


def _chunk_id(chunk: Chunk) -> str:
    return f"{chunk.source}::{chunk.title}::{hash(chunk.text)}"


def reciprocal_rank_fusion(*ranked_lists: list[Chunk], k: int = RRF_K) -> list[Chunk]:
    scores: dict[str, float] = defaultdict(float)
    by_id: dict[str, Chunk] = {}
    for ranked in ranked_lists:
        for rank, chunk in enumerate(ranked):
            cid = _chunk_id(chunk)
            by_id[cid] = chunk
            scores[cid] += 1.0 / (k + rank + 1)
    ordered_ids = sorted(scores, key=lambda cid: scores[cid], reverse=True)
    return [by_id[cid] for cid in ordered_ids]


def hybrid_retrieve(
    query: str,
    top_k: int = 5,
    vector_search_fn: Callable[[str, int], list[Chunk]] | None = None,
    candidate_k: int = 10,
) -> list[Chunk]:
    """vector_search_fn defaults to querying the real PGVector store via
    services.rag_service.get_rag_service(); injectable so tests can supply a
    fake without needing live Postgres (same pattern used throughout Phase
    1's tests)."""
    if vector_search_fn is None:
        vector_search_fn = _default_vector_search

    vector_results = vector_search_fn(query, candidate_k)
    bm25_results = get_bm25_index().search(query, candidate_k)
    fused = reciprocal_rank_fusion(vector_results, bm25_results)
    return fused[:top_k]


def _default_vector_search(query: str, k: int) -> list[Chunk]:
    from services.rag_service import get_rag_service

    docs = get_rag_service().retrieve(query)
    return [
        Chunk(text=doc.page_content, source=doc.metadata.get("source", "vector-store"), kind="prose")
        for doc in docs[:k]
    ]
