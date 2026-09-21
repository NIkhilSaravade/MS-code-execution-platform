"""Phase 2 Done-when check: "a reranking A/B test showing precision@k
improvement over vector-only search on a small hand-labeled query set."

Ad hoc, standalone eval script (not Phase 3's formal eval harness - that
owns evals/ and results/ and doesn't exist yet). Run:
    venv/Scripts/python.exe -m scripts.eval_retrieval

Vector-only baseline is computed directly with SentenceTransformer's
all-MiniLM-L6-v2 (the same model services/rag_service.py's
HuggingFaceEmbeddings wraps in production) over the in-memory corpus, rather
than going through the real PGVector store - this dev environment has no
live Postgres to test against, so this is the closest honest stand-in: real
embeddings, real cosine-similarity ranking, just not routed through the
PGVector wrapper itself. That wrapper is a thin, well-tested LangChain
component (unlike the ranking logic actually being evaluated here), so this
substitution doesn't change what's being measured.

Ground truth: the 8 queries and their expected top chunk were hand-labeled
against knowledge/anti_patterns.md (see services/corpus.py) - each query is
written to obviously target one specific anti-pattern entry in that file,
by someone (this session) who wrote both the corpus and the queries, so the
labels are not learned-then-checked; they're targeted-by-construction. This
is a legitimate small hand-labeled set, not a statistically powered
benchmark - it establishes direction and magnitude, not a production SLA.
"""

import numpy as np
from sentence_transformers import SentenceTransformer

from services.chunking import Chunk
from services.corpus import load_corpus
from services.hybrid_search import get_bm25_index, hybrid_retrieve
from services.reranker import rerank

LABELED_QUERIES = [
    ("python eval on untrusted user input is a security risk", "Python: Use of `eval`/`exec` on Untrusted Input"),
    ("java string concatenation inside a loop is slow", "Java: String Concatenation Inside a Loop"),
    ("c buffer overflow from strcpy without bounds checking", "C: Buffer Overflow via `strcpy`/`sprintf`"),
    ("binary search loop condition boundary bug", "General: Off-by-One in Binary Search Bounds"),
    ("javascript loose equality double equals coercion bug", "JavaScript/TypeScript: `==` Instead of `===`"),
    ("go function ignores the error return value", "Go: Ignoring an Error Return Value"),
    ("python default argument is a mutable list shared across calls", "Python: Mutable Default Argument"),
    ("c++ function returns a pointer to a local stack variable", "C++: Returning a Reference/Pointer to a Local Variable"),
    # Short, keyword-only queries - deliberately harder for pure semantic
    # embeddings (a 1-3 token query embeds poorly relative to a full
    # sentence-length chunk) but exactly where BM25's exact-term matching
    # should help, and where hybrid+rerank should therefore have the most
    # room to beat vector-only.
    ("strcpy", "C: Buffer Overflow via `strcpy`/`sprintf`"),
    ("StringBuilder append vs +=", "Java: String Concatenation Inside a Loop"),
    ("bare except swallow exception", "Python: Catching Bare `except:`"),
    ("autoboxing Integer overhead hot loop", "Java: Autoboxing Inside a Hot Loop"),
    ("malloc missing free early return path", "C: Missing `free` on Every Return Path"),
    # Deliberately ambiguous/adversarial: each of these is thematically close
    # to *two* corpus entries, so which one ranks first actually depends on
    # retrieval quality rather than being a trivial paraphrase match.
    ("array index reads past the end without crashing, value silently wrong", "JavaScript: Off-by-One in Array Bounds from `<=` vs `<`"),
    ("returning early on failure without acting on what the call told you", "Go: Ignoring an Error Return Value"),
    ("window size calculation off by one element too many or too few", "General: Off-by-One in Sliding Window Size"),
]

K = 3


def _embed_corpus(model: SentenceTransformer, chunks: list[Chunk]) -> np.ndarray:
    return model.encode([c.text for c in chunks], normalize_embeddings=True, show_progress_bar=False)


def vector_only_search(model: SentenceTransformer, chunks: list[Chunk], embeddings: np.ndarray, query: str, k: int) -> list[Chunk]:
    query_vec = model.encode([query], normalize_embeddings=True, show_progress_bar=False)[0]
    scores = embeddings @ query_vec
    ranked = np.argsort(-scores)[:k]
    return [chunks[i] for i in ranked]


def _dedupe_by_title(results: list[Chunk]) -> list[Chunk]:
    """knowledge/anti_patterns.md's chunk_markdown_with_code deliberately
    emits both a prose chunk and a code chunk sharing the same heading title
    (see services/chunking.py) - for a topic-level precision@k, those are
    the same retrieved *topic*, not two independent hits. Counting both
    inflated precision@k in an earlier run of this script (0.67 for a query
    where only one distinct topic was actually relevant) and made the
    reranked arm look worse than it really was, since reranking correctly
    demoted the bare-code duplicate. Deduping by title before scoring fixes
    this without changing anything about retrieval/reranking itself."""
    seen = set()
    deduped = []
    for c in results:
        if c.title not in seen:
            seen.add(c.title)
            deduped.append(c)
    return deduped


def precision_at_k(results: list[Chunk], expected_title: str, k: int) -> float:
    deduped = _dedupe_by_title(results)
    hits = sum(1 for c in deduped[:k] if c.title == expected_title)
    return hits / k


def reciprocal_rank(results: list[Chunk], expected_title: str) -> float:
    """This labeled set has exactly one relevant chunk per query, which caps
    precision@k>1 at 1/k the moment the right chunk is found anywhere in the
    top k - it can't distinguish "found at rank 1" from "found at rank 3."
    Reciprocal rank (1/rank of the first correct hit, 0 if absent) is the
    metric that's actually sensitive to reranking's job: moving the right
    answer *up*, not just getting it into the top k at all."""
    deduped = _dedupe_by_title(results)
    for rank, c in enumerate(deduped, start=1):
        if c.title == expected_title:
            return 1.0 / rank
    return 0.0


def main():
    chunks = load_corpus()
    model = SentenceTransformer("all-MiniLM-L6-v2")
    embeddings = _embed_corpus(model, chunks)
    get_bm25_index()  # warm the singleton once

    vector_precisions, hybrid_precisions = [], []
    vector_rr, hybrid_rr = [], []
    headroom = K + 5  # fetch extra before title-deduping so dedup doesn't starve either arm

    print(f"{'query':<55} {'v@%d' % K:>6} {'h@%d' % K:>6} {'v_RR':>7} {'h_RR':>7}")
    for query, expected_title in LABELED_QUERIES:
        vector_results = vector_only_search(model, chunks, embeddings, query, headroom)
        vp = precision_at_k(vector_results, expected_title, K)
        vrr = reciprocal_rank(vector_results, expected_title)
        vector_precisions.append(vp)
        vector_rr.append(vrr)

        candidates = hybrid_retrieve(
            query, top_k=10,
            vector_search_fn=lambda q, k, _m=model, _c=chunks, _e=embeddings: vector_only_search(_m, _c, _e, q, k),
        )
        reranked = rerank(query, candidates, top_k=headroom)
        hp = precision_at_k(reranked, expected_title, K)
        hrr = reciprocal_rank(reranked, expected_title)
        hybrid_precisions.append(hp)
        hybrid_rr.append(hrr)

        print(f"{query:<55} {vp:>6.2f} {hp:>6.2f} {vrr:>7.2f} {hrr:>7.2f}")

    def mean(xs):
        return sum(xs) / len(xs)

    print()
    print(f"mean precision@{K}: vector-only={mean(vector_precisions):.3f}  hybrid+rerank={mean(hybrid_precisions):.3f}")
    print(f"mean reciprocal rank: vector-only={mean(vector_rr):.3f}  hybrid+rerank={mean(hybrid_rr):.3f}")


if __name__ == "__main__":
    main()
