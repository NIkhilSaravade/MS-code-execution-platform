"""Chunking strategies for Phase 2's real RAG corpus - replaces treating
each source document as one giant blob (or, before this, treating 5
hardcoded one-liners as "the corpus" at all - see seed_knowledge.py before
this phase).

Two strategies, chosen by content type:
  - chunk_markdown: heading-based - each chunk is one heading plus the prose
    directly under it, up to the next heading of the same or shallower
    level. This is "semantic chunking" in the practical sense used for prose
    docs: a heading marks a genuine topic boundary a human author already
    drew, so splitting there keeps each chunk topically coherent without
    needing an embedding-based splitter.
  - chunk_python_code: AST-aware - parses the snippet with the stdlib `ast`
    module and yields one chunk per top-level function/class definition,
    rather than splitting on blank lines or a fixed character count, which
    would routinely cut a function in half. Falls back to treating the
    whole snippet as one chunk if it doesn't parse (e.g. a deliberately
    broken example, or a fenced block that isn't actually valid Python).
"""

import ast
import re
from dataclasses import dataclass, field


@dataclass
class Chunk:
    text: str
    source: str
    kind: str  # "prose" | "code"
    title: str = ""
    metadata: dict = field(default_factory=dict)


_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")


def chunk_markdown(text: str, source: str) -> list[Chunk]:
    lines = text.splitlines()
    chunks: list[Chunk] = []
    current_title = ""
    current_lines: list[str] = []

    def flush():
        body = "\n".join(current_lines).strip()
        if not body and not current_title:
            return
        full_text = f"{current_title}\n{body}".strip() if current_title else body
        if full_text:
            chunks.append(Chunk(text=full_text, source=source, kind="prose", title=current_title))

    for line in lines:
        match = _HEADING_RE.match(line)
        if match:
            flush()
            current_title = match.group(2).strip()
            current_lines = []
        else:
            current_lines.append(line)
    flush()

    return [c for c in chunks if len(c.text.strip()) > 0]


def chunk_python_code(code: str, source: str) -> list[Chunk]:
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return [Chunk(text=code, source=source, kind="code", title=source)]

    lines = code.splitlines()
    chunks: list[Chunk] = []
    top_level_defs = [
        node for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
    ]

    if not top_level_defs:
        return [Chunk(text=code, source=source, kind="code", title=source)]

    for node in top_level_defs:
        end_line = getattr(node, "end_lineno", node.lineno)
        snippet = "\n".join(lines[node.lineno - 1:end_line])
        chunks.append(Chunk(text=snippet, source=source, kind="code", title=node.name))

    return chunks


_FENCED_PYTHON_RE = re.compile(r"```python\n(.*?)```", re.DOTALL)


def chunk_markdown_with_code(text: str, source: str) -> list[Chunk]:
    """Like chunk_markdown, but any fenced ```python block inside a heading's
    body is additionally AST-chunked and emitted as its own code chunk(s),
    tagged with the enclosing heading as metadata - used for
    knowledge/anti_patterns.md, where each heading is one anti-pattern with
    a prose explanation plus a code example."""
    prose_chunks = chunk_markdown(text, source)
    code_chunks: list[Chunk] = []

    for prose in prose_chunks:
        for match in _FENCED_PYTHON_RE.finditer(prose.text):
            snippet = match.group(1)
            for code_chunk in chunk_python_code(snippet, source):
                code_chunk.metadata["heading"] = prose.title
                code_chunk.title = prose.title
                code_chunks.append(code_chunk)

    return prose_chunks + code_chunks
