from services.chunking import Chunk
from services.hybrid_search import BM25Index, hybrid_retrieve, reciprocal_rank_fusion

CORPUS = [
    Chunk(text="strcpy overflows the destination buffer in C", source="a.md", kind="prose", title="strcpy"),
    Chunk(text="mutable default arguments leak state between calls in Python", source="b.md", kind="prose", title="mutable-default"),
    Chunk(text="binary search off by one in the loop bound", source="c.md", kind="prose", title="binary-search"),
]


def test_bm25_search_finds_exact_keyword_match():
    index = BM25Index(CORPUS)
    results = index.search("strcpy buffer", k=2)
    assert results[0].title == "strcpy"


def test_bm25_search_empty_corpus_returns_nothing():
    index = BM25Index([])
    assert index.search("anything", k=3) == []


def test_reciprocal_rank_fusion_favors_items_ranked_first_in_both_lists():
    list_a = [CORPUS[0], CORPUS[1], CORPUS[2]]
    list_b = [CORPUS[0], CORPUS[2], CORPUS[1]]
    fused = reciprocal_rank_fusion(list_a, list_b)
    assert fused[0].title == "strcpy"  # rank 1 in both


def test_reciprocal_rank_fusion_includes_items_from_only_one_list():
    list_a = [CORPUS[1]]
    list_b = [CORPUS[2]]
    fused = reciprocal_rank_fusion(list_a, list_b)
    assert {c.title for c in fused} == {"mutable-default", "binary-search"}


def test_hybrid_retrieve_merges_vector_and_bm25_results(monkeypatch):
    monkeypatch.setattr("services.hybrid_search.get_bm25_index", lambda: BM25Index(CORPUS))

    def fake_vector_search(query, k):
        return [CORPUS[1]]  # pretend semantic search only finds the Python entry

    results = hybrid_retrieve("strcpy", top_k=3, vector_search_fn=fake_vector_search)
    titles = {c.title for c in results}
    # BM25 found "strcpy" via keyword match, vector search found "mutable-default" -
    # both should be present in the fused result even though neither alone had both.
    assert "strcpy" in titles
    assert "mutable-default" in titles
