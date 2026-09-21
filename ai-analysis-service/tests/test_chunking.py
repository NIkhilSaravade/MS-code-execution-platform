from services.chunking import chunk_markdown, chunk_markdown_with_code, chunk_python_code

SAMPLE_MARKDOWN = """# Title

Intro paragraph.

## Section A

Body of section A.

## Section B

Body of section B.
Second line of B.
"""

SAMPLE_CODE_MARKDOWN = """## Bad Pattern

Some prose explaining the issue.

```python
def leaky(item, bucket=[]):
    bucket.append(item)
    return bucket
```

## Another Pattern

More prose.
"""


def test_chunk_markdown_splits_on_headings():
    chunks = chunk_markdown(SAMPLE_MARKDOWN, "sample.md")
    titles = [c.title for c in chunks]
    assert titles == ["Title", "Section A", "Section B"]
    section_b = next(c for c in chunks if c.title == "Section B")
    assert "Second line of B." in section_b.text


def test_chunk_markdown_all_chunks_tag_source():
    chunks = chunk_markdown(SAMPLE_MARKDOWN, "sample.md")
    assert all(c.source == "sample.md" for c in chunks)
    assert all(c.kind == "prose" for c in chunks)


def test_chunk_python_code_one_chunk_per_top_level_def():
    code = "def a():\n    return 1\n\n\ndef b():\n    return 2\n"
    chunks = chunk_python_code(code, "snippet.py")
    assert [c.title for c in chunks] == ["a", "b"]
    assert "return 1" in chunks[0].text
    assert "return 2" in chunks[1].text


def test_chunk_python_code_falls_back_on_syntax_error():
    broken = "def a(:\n    this is not valid python\n"
    chunks = chunk_python_code(broken, "broken.py")
    assert len(chunks) == 1
    assert chunks[0].text == broken


def test_chunk_markdown_with_code_extracts_fenced_python_as_code_chunk():
    chunks = chunk_markdown_with_code(SAMPLE_CODE_MARKDOWN, "sample.md")
    prose = [c for c in chunks if c.kind == "prose"]
    code = [c for c in chunks if c.kind == "code"]
    assert len(prose) == 2
    assert len(code) == 1
    assert code[0].title == "Bad Pattern"  # tagged with enclosing heading
    assert "def leaky" in code[0].text
