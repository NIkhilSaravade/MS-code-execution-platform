"""Builds the real Phase 2 corpus from actual repo content, replacing
seed_knowledge.py's 5 hardcoded one-liners:
  - ai-analysis-service/knowledge/anti_patterns.md - curated per-language
    anti-pattern / CVE-adjacent reference (see that file), heading- and
    AST-chunked via chunk_markdown_with_code.
  - This repo's own architecture docs (docs/*.md) and CLAUDE.md - real
    prose about this specific codebase, heading-chunked via chunk_markdown.
    This is what the task brief calls "this repo's own style/contribution
    docs."

Run as a script (`python -m services.corpus`) to (re)write
knowledge/corpus.json, the on-disk chunk list both the BM25 index
(services/hybrid_search.py) and the vector-store ingestion step below load
from - a discrete, reproducible ingestion step rather than re-walking the
filesystem on every service start.
"""

import json
from dataclasses import asdict
from pathlib import Path

from services.chunking import Chunk, chunk_markdown, chunk_markdown_with_code

_THIS_DIR = Path(__file__).resolve().parent
_SERVICE_ROOT = _THIS_DIR.parent
_REPO_ROOT = _SERVICE_ROOT.parent
_CORPUS_JSON_PATH = _SERVICE_ROOT / "knowledge" / "corpus.json"


def build_corpus() -> list[Chunk]:
    chunks: list[Chunk] = []

    anti_patterns_path = _SERVICE_ROOT / "knowledge" / "anti_patterns.md"
    if anti_patterns_path.exists():
        text = anti_patterns_path.read_text(encoding="utf-8")
        chunks.extend(chunk_markdown_with_code(text, "knowledge/anti_patterns.md"))

    docs_dir = _REPO_ROOT / "docs"
    if docs_dir.exists():
        for md_path in sorted(docs_dir.glob("*.md")):
            if md_path.name == "ai-agent-build-log.md":
                continue  # this file itself - not review-relevant reference material
            text = md_path.read_text(encoding="utf-8")
            chunks.extend(chunk_markdown(text, f"docs/{md_path.name}"))

    claude_md_path = _REPO_ROOT / "CLAUDE.md"
    if claude_md_path.exists():
        text = claude_md_path.read_text(encoding="utf-8")
        chunks.extend(chunk_markdown(text, "CLAUDE.md"))

    return chunks


def save_corpus(chunks: list[Chunk], path: Path = _CORPUS_JSON_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps([asdict(c) for c in chunks], indent=2),
        encoding="utf-8",
    )


def load_corpus(path: Path = _CORPUS_JSON_PATH) -> list[Chunk]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return [Chunk(**item) for item in raw]


if __name__ == "__main__":
    corpus = build_corpus()
    save_corpus(corpus)
    print(f"Wrote {len(corpus)} chunks to {_CORPUS_JSON_PATH}")
