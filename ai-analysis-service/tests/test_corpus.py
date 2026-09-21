from pathlib import Path

from services.corpus import build_corpus, load_corpus, save_corpus


def test_build_corpus_includes_real_anti_patterns_and_repo_docs():
    chunks = build_corpus()
    assert len(chunks) > 50  # real corpus, not 5 hardcoded facts

    sources = {c.source for c in chunks}
    assert "knowledge/anti_patterns.md" in sources
    assert any(s.startswith("docs/") for s in sources)

    titles = {c.title for c in chunks}
    assert "Python: Use of `eval`/`exec` on Untrusted Input" in titles


def test_save_and_load_corpus_round_trips(tmp_path):
    chunks = build_corpus()[:5]
    path = Path(tmp_path) / "corpus.json"
    save_corpus(chunks, path)
    loaded = load_corpus(path)

    assert len(loaded) == len(chunks)
    assert [c.title for c in loaded] == [c.title for c in chunks]
    assert [c.text for c in loaded] == [c.text for c in chunks]
