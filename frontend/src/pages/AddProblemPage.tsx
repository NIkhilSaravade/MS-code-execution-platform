// The admin-only "create a new problem from scratch" form (ADMIN-gated by
// App.tsx's <AdminRoute>, itself layered under <ProtectedRoute>). One big
// page, not a wizard - the admin fills everything in, in one pass, and hits
// Submit once at the bottom. Follows this app's existing convention of
// large single-file pages with big inline JSX (see SolvePage.tsx) rather
// than splitting every repeated row into its own component - defining a
// component INSIDE this one's render body would give React a new component
// type every render and drop input focus on every keystroke, so every
// repeater below (Examples/Params/Test Cases/Solution Parts/Code Snippets)
// is plain inline JSX inside a .map(), not a nested component.

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import Logo from '../components/landing/Logo';
import { useAuth } from '../context/AuthContext';
import { LANGUAGES, type Difficulty } from '../data/problems';
import {
  createProblem,
  updateProblem,
  getProblem,
  getTestCases,
  type CreateProblemRequest,
  type Example,
  type FunctionParam,
  type TestCaseInput,
} from '../api/problems';
import { upsertSolution, uploadVisualizer, getSolutionForProblem } from '../api/solutions';
import { API_BASE_URL } from '../api/client';

const TYPE_OPTIONS: FunctionParam['type'][] = ['int', 'int[]', 'int[][]', 'string', 'bool'];
const DIFFICULTY_OPTIONS: Difficulty[] = ['Easy', 'Medium', 'Hard'];

// The whole solution write-up is ONE ordered sequence of blocks - not split
// into 12 separate titled parts. Paste as much prose as you like into a
// single text block (a whole multi-section write-up, headings and all, if
// that's how it was written), and insert a code block wherever code needs
// to appear - in between two text blocks, or several in a row. Every code
// block still always renders fenced (```language ... ```) when the final
// markdown is built, so pasted code never needs the admin to type backticks
// themselves; that's the one thing this editor does FOR you, everything
// else is exactly what you paste.
let blockIdCounter = 0;
function nextBlockId(): string {
  blockIdCounter += 1;
  return `block-${blockIdCounter}`;
}

interface TextBlock {
  kind: 'text';
  id: string;
  content: string;
}
interface CodeBlock {
  kind: 'code';
  id: string;
  language: string;
  caption: string;
  code: string;
}
type SolutionBlock = TextBlock | CodeBlock;

// Renders the whole block sequence, in order, as one markdown string -
// solution-service still stores this as a single SolutionPart (ordinal 1),
// it's just no longer split into 12 separate titled ones.
function buildSolutionMarkdown(blocks: SolutionBlock[]): string {
  const pieces = blocks
    .map((b) => {
      if (b.kind === 'text') return b.content.trim();
      if (!b.code.trim()) return '';
      const fence = '```' + b.language + '\n' + b.code.trim() + '\n```';
      return b.caption.trim() ? `**${b.caption.trim()}**\n\n${fence}` : fence;
    })
    .filter(Boolean);
  return pieces.join('\n\n');
}

// The inverse of buildSolutionMarkdown - splits stored markdown back into
// the editable block list, so an existing write-up round-trips into the
// same block editor a fresh one would produce. Matches each fenced
// ```language ... ``` section (optionally preceded by a **caption** line,
// exactly as buildSolutionMarkdown emits it) as a code block; everything
// else becomes a text block.
function parseMarkdownIntoBlocks(markdown: string): SolutionBlock[] {
  const blocks: SolutionBlock[] = [];
  const fenceRegex = /(?:\*\*(.*?)\*\*\n\n)?```(\w*)\n([\s\S]*?)\n```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fenceRegex.exec(markdown)) !== null) {
    const [full, caption, language, code] = match;
    const textBefore = markdown.slice(lastIndex, match.index).trim();
    if (textBefore) {
      blocks.push({ kind: 'text', id: nextBlockId(), content: textBefore });
    }
    blocks.push({
      kind: 'code',
      id: nextBlockId(),
      language: language || 'python',
      caption: caption ?? '',
      code: code.trim(),
    });
    lastIndex = match.index + full.length;
  }

  const trailingText = markdown.slice(lastIndex).trim();
  if (trailingText) {
    blocks.push({ kind: 'text', id: nextBlockId(), content: trailingText });
  }

  return blocks;
}

const labelStyle = { fontSize: 13, fontWeight: 600, color: '#cdd3e0' };
const inputStyle = {
  width: '100%',
  padding: '10px 13px',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,.12)',
  background: 'rgba(255,255,255,.04)',
  color: '#eef0f6',
  fontSize: 13.5,
  fontFamily: 'inherit',
  outline: 'none',
};
const textareaStyle = { ...inputStyle, resize: 'vertical' as const, lineHeight: 1.6 };
const codeAreaStyle = { ...textareaStyle, fontFamily: "'JetBrains Mono',monospace", fontSize: 12.5 };
const cardStyle = {
  border: '1px solid rgba(255,255,255,.08)',
  borderRadius: 14,
  padding: '20px 22px',
  marginBottom: 20,
};
const sectionTitleStyle = {
  fontFamily: "'Space Grotesk',sans-serif",
  fontWeight: 700,
  fontSize: 17,
  margin: '0 0 4px',
};
const sectionSubStyle = { fontSize: 12.5, color: '#8b93a8', margin: '0 0 16px' };
const smallBtnStyle = {
  fontFamily: 'inherit',
  fontSize: 12,
  fontWeight: 700,
  padding: '7px 13px',
  borderRadius: 8,
  border: '1px solid rgba(167,139,250,.35)',
  background: 'rgba(124,58,237,.12)',
  color: '#c4b5fd',
  cursor: 'pointer',
};
const removeBtnStyle = {
  fontFamily: 'inherit',
  fontSize: 12,
  fontWeight: 700,
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid rgba(248,113,113,.3)',
  background: 'rgba(248,113,113,.08)',
  color: '#fca5a5',
  cursor: 'pointer',
};
const rowCardStyle = {
  border: '1px solid rgba(255,255,255,.07)',
  borderRadius: 10,
  padding: 14,
  marginBottom: 12,
  background: 'rgba(255,255,255,.02)',
};

export default function AddProblemPage() {
  const { accessToken } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditMode = id !== undefined;
  const problemId = id !== undefined ? Number(id) : null;

  const [name, setName] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>('Medium');
  const [tagsInput, setTagsInput] = useState('');

  const [description, setDescription] = useState('');
  const [examples, setExamples] = useState<Example[]>([{ input: '', output: '', explanation: '' }]);
  const [constraints, setConstraints] = useState('');

  const [functionName, setFunctionName] = useState('');
  const [returnType, setReturnType] = useState<FunctionParam['type']>('int');
  const [params, setParams] = useState<FunctionParam[]>([]);

  const [testCases, setTestCases] = useState<TestCaseInput[]>([
    { input: '', expectedOutput: '', hidden: false },
  ]);

  const [solutionBlocks, setSolutionBlocks] = useState<SolutionBlock[]>([]);
  const [visualizerHtml, setVisualizerHtml] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(isEditMode);

  // Read through a ref inside the prefill effect below so a background
  // token rotation (see PracticePage/SolvePage's identical pattern) can't
  // re-run the fetch-and-prefill after the admin has already started
  // editing fields, which would silently clobber their in-progress edits.
  const accessTokenRef = useRef(accessToken);
  useEffect(() => {
    accessTokenRef.current = accessToken;
  }, [accessToken]);

  // Edit mode: load the existing problem/testcases/solution/visualizer once
  // on mount and prefill every field. Deliberately keyed only on problemId
  // (not accessToken) - see accessTokenRef above.
  useEffect(() => {
    if (problemId === null) return;
    const token = accessTokenRef.current;
    if (!token) return;

    let cancelled = false;

    (async () => {
      try {
        const [problem, existingTestCases, solution] = await Promise.all([
          getProblem(token, problemId),
          getTestCases(token, problemId),
          getSolutionForProblem(token, problemId),
        ]);
        if (cancelled) return;

        setName(problem.name);
        setDifficulty((problem.difficulty as Difficulty) ?? 'Medium');
        setTagsInput(problem.tags.join(', '));
        setDescription(problem.description);
        setExamples(
          problem.examples.length > 0
            ? problem.examples
            : [{ input: '', output: '', explanation: '' }],
        );
        setConstraints(problem.constraints);
        if (problem.functionName) {
          setFunctionName(problem.functionName);
          setReturnType((problem.returnType as FunctionParam['type']) ?? 'int');
          setParams(problem.params ?? []);
        }
        setTestCases(
          existingTestCases.length > 0
            ? existingTestCases
            : [{ input: '', expectedOutput: '', hidden: false }],
        );

        if (solution) {
          const combinedMarkdown = solution.parts.map((p) => p.markdown).join('\n\n');
          setSolutionBlocks(parseMarkdownIntoBlocks(combinedMarkdown));

          if (solution.visualizerUrl) {
            try {
              const res = await fetch(`${API_BASE_URL}${solution.visualizerUrl}`);
              if (res.ok && !cancelled) {
                setVisualizerHtml(await res.text());
              }
            } catch {
              // Best-effort - the rest of the form is still usable without
              // the visualizer prefilled.
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          setSubmitError(
            err instanceof Error ? `Failed to load problem: ${err.message}` : 'Failed to load problem.',
          );
        }
      } finally {
        if (!cancelled) setLoadingExisting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [problemId]);

  // ---- Examples repeater ----
  function addExample() {
    setExamples((prev) => [...prev, { input: '', output: '', explanation: '' }]);
  }
  function removeExample(index: number) {
    setExamples((prev) => prev.filter((_, i) => i !== index));
  }
  function updateExample(index: number, field: keyof Example, value: string) {
    setExamples((prev) => prev.map((e, i) => (i === index ? { ...e, [field]: value } : e)));
  }

  // ---- Function signature params repeater ----
  function addParam() {
    setParams((prev) => [...prev, { name: '', type: 'int' }]);
  }
  function removeParam(index: number) {
    setParams((prev) => prev.filter((_, i) => i !== index));
  }
  function updateParam(index: number, field: keyof FunctionParam, value: string) {
    setParams((prev) =>
      prev.map((p, i) => (i === index ? { ...p, [field]: value as FunctionParam['type'] } : p)),
    );
  }

  // ---- Test cases repeater ----
  function addTestCase() {
    setTestCases((prev) => [...prev, { input: '', expectedOutput: '', hidden: false }]);
  }
  function removeTestCase(index: number) {
    setTestCases((prev) => prev.filter((_, i) => i !== index));
  }
  function updateTestCase(index: number, field: keyof TestCaseInput, value: string | boolean) {
    setTestCases((prev) => prev.map((tc, i) => (i === index ? { ...tc, [field]: value } : tc)));
  }

  // ---- Solution: one ordered list of text/code blocks for the whole write-up ----
  function addTextBlock() {
    setSolutionBlocks((prev) => [...prev, { kind: 'text', id: nextBlockId(), content: '' }]);
  }
  function addCodeBlock() {
    setSolutionBlocks((prev) => [
      ...prev,
      { kind: 'code', id: nextBlockId(), language: 'python', caption: '', code: '' },
    ]);
  }
  function removeBlock(blockId: string) {
    setSolutionBlocks((prev) => prev.filter((b) => b.id !== blockId));
  }
  function moveBlock(blockId: string, direction: -1 | 1) {
    setSolutionBlocks((prev) => {
      const index = prev.findIndex((b) => b.id === blockId);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }
  function updateTextBlock(blockId: string, content: string) {
    setSolutionBlocks((prev) =>
      prev.map((b) => (b.id === blockId && b.kind === 'text' ? { ...b, content } : b)),
    );
  }
  function updateCodeBlock(blockId: string, field: 'language' | 'caption' | 'code', value: string) {
    setSolutionBlocks((prev) =>
      prev.map((b) => (b.id === blockId && b.kind === 'code' ? { ...b, [field]: value } : b)),
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    if (!accessToken) return;
    if (!name.trim() || !description.trim()) {
      setSubmitError('Title and description are required.');
      return;
    }
    const nonEmptyTestCases = testCases.filter((tc) => tc.input.trim() || tc.expectedOutput.trim());
    if (nonEmptyTestCases.length === 0) {
      setSubmitError('At least one test case is required.');
      return;
    }

    setSubmitting(true);

    const request: CreateProblemRequest = {
      name: name.trim(),
      description: description.trim(),
      constraints: constraints.trim(),
      difficulty,
      tags: tagsInput.split(',').map((t) => t.trim()).filter(Boolean),
      examples: examples.filter((ex) => ex.input.trim() || ex.output.trim()),
      testCases: nonEmptyTestCases,
      ...(functionName.trim()
        ? { signature: { functionName: functionName.trim(), params, returnType } }
        : {}),
    };

    let targetProblemId: number;
    try {
      if (isEditMode && problemId !== null) {
        await updateProblem(accessToken, problemId, request);
        targetProblemId = problemId;
      } else {
        const created = await createProblem(accessToken, request);
        targetProblemId = created.id;
      }
    } catch (err) {
      const verb = isEditMode ? 'update' : 'create';
      setSubmitError(err instanceof Error ? `Failed to ${verb} problem: ${err.message}` : `Failed to ${verb} problem.`);
      setSubmitting(false);
      return;
    }

    try {
      const solutionMarkdown = buildSolutionMarkdown(solutionBlocks);
      if (solutionMarkdown) {
        // solution-service still stores this as a list of "parts" - a
        // single one (ordinal 1) is exactly a one-part list, so no backend
        // change was needed to stop splitting the write-up into 12.
        await upsertSolution(accessToken, targetProblemId, [
          { ordinal: 1, title: 'Solution', markdown: solutionMarkdown },
        ]);
      }
      if (visualizerHtml.trim()) {
        await uploadVisualizer(accessToken, targetProblemId, visualizerHtml);
      }
    } catch (err) {
      // The problem itself is real and already created - don't lose that
      // fact behind a generic error, since a re-submit of this whole form
      // would create a SECOND problem rather than fixing this one.
      const problemVerbPast = isEditMode ? 'updated' : 'created';
      setSubmitError(
        `Problem ${problemVerbPast} (#${targetProblemId}), but saving the solution/visualizer failed: ${
          err instanceof Error ? err.message : 'unknown error'
        }. You can open the problem and it will still work - the solution content just wasn't saved.`,
      );
      setSubmitting(false);
      return;
    }

    navigate(`/practice/${targetProblemId}`);
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#080a14',
        color: '#eef0f6',
        fontFamily: "'Manrope',system-ui,sans-serif",
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 20,
          padding: '10px 20px',
          borderBottom: '1px solid rgba(255,255,255,.08)',
        }}
      >
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none' }}>
          <Logo size={22} boxSize={10} />
        </Link>
        <Link to="/practice" style={{ fontSize: 13, color: '#9aa2b8', textDecoration: 'none', fontWeight: 600 }}>
          ← Practice
        </Link>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#eef0f6' }}>
          {isEditMode ? 'Edit Problem' : 'Add Problem'}
        </span>
      </header>

      {loadingExisting ? (
        <div style={{ padding: '80px 28px', textAlign: 'center', color: '#8b93a8', fontSize: 14 }}>
          Loading problem…
        </div>
      ) : (
      <form onSubmit={handleSubmit} style={{ maxWidth: 860, margin: '0 auto', padding: '36px 28px 100px' }}>
        {/* ---- Title / Difficulty / Tags ---- */}
        <div style={cardStyle}>
          <h2 style={sectionTitleStyle}>Problem details</h2>
          <p style={sectionSubStyle}>The basics shown on the Practice list.</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={labelStyle}>Title</span>
              <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} required />
            </label>
            <div style={{ display: 'flex', gap: 14 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                <span style={labelStyle}>Difficulty</span>
                <select
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value as Difficulty)}
                  style={inputStyle}
                >
                  {DIFFICULTY_OPTIONS.map((d) => (
                    <option key={d} value={d} style={{ background: '#14162a' }}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 2 }}>
                <span style={labelStyle}>Tags (comma-separated)</span>
                <input
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="Array, Hash Table"
                  style={inputStyle}
                />
              </label>
            </div>
          </div>
        </div>

        {/* ---- Description / Examples / Constraints ---- */}
        <div style={cardStyle}>
          <h2 style={sectionTitleStyle}>Description</h2>
          <p style={sectionSubStyle}>The problem statement, worked examples, and constraints.</p>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
            <span style={labelStyle}>Problem statement</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{ ...textareaStyle, minHeight: 120 }}
              required
            />
          </label>

          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
              <span style={labelStyle}>Examples</span>
              <div style={{ flex: 1 }} />
              <button type="button" onClick={addExample} style={smallBtnStyle}>
                + Add example
              </button>
            </div>
            {examples.map((ex, i) => (
              <div key={i} style={rowCardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#9aa2b8' }}>Example {i + 1}</span>
                  {examples.length > 1 && (
                    <button type="button" onClick={() => removeExample(i)} style={removeBtnStyle}>
                      Remove
                    </button>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input
                    value={ex.input}
                    onChange={(e) => updateExample(i, 'input', e.target.value)}
                    placeholder="Input, e.g. nums = [2,7,11,15], target = 9"
                    style={inputStyle}
                  />
                  <input
                    value={ex.output}
                    onChange={(e) => updateExample(i, 'output', e.target.value)}
                    placeholder="Output, e.g. [0,1]"
                    style={inputStyle}
                  />
                  <input
                    value={ex.explanation ?? ''}
                    onChange={(e) => updateExample(i, 'explanation', e.target.value)}
                    placeholder="Explanation (optional)"
                    style={inputStyle}
                  />
                </div>
              </div>
            ))}
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={labelStyle}>Constraints (one per line)</span>
            <textarea
              value={constraints}
              onChange={(e) => setConstraints(e.target.value)}
              style={{ ...codeAreaStyle, minHeight: 90 }}
              placeholder={'2 <= nums.length <= 10^4\n-10^9 <= nums[i] <= 10^9'}
            />
          </label>
        </div>

        {/* ---- Function signature ---- */}
        <div style={cardStyle}>
          <h2 style={sectionTitleStyle}>Function signature</h2>
          <p style={sectionSubStyle}>
            Optional - leave the function name blank for a raw stdin/stdout judge. If filled in, starter
            code for all 7 languages is generated automatically from this.
          </p>

          <div style={{ display: 'flex', gap: 14, marginBottom: 14 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 2 }}>
              <span style={labelStyle}>Function name</span>
              <input
                value={functionName}
                onChange={(e) => setFunctionName(e.target.value)}
                placeholder="twoSum"
                style={{ ...inputStyle, fontFamily: "'JetBrains Mono',monospace" }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
              <span style={labelStyle}>Return type</span>
              <select
                value={returnType}
                onChange={(e) => setReturnType(e.target.value as FunctionParam['type'])}
                style={inputStyle}
              >
                {TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t} style={{ background: '#14162a' }}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
            <span style={labelStyle}>Parameters</span>
            <div style={{ flex: 1 }} />
            <button type="button" onClick={addParam} style={smallBtnStyle}>
              + Add parameter
            </button>
          </div>
          {params.map((p, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'center' }}>
              <input
                value={p.name}
                onChange={(e) => updateParam(i, 'name', e.target.value)}
                placeholder="nums"
                style={{ ...inputStyle, fontFamily: "'JetBrains Mono',monospace", flex: 2 }}
              />
              <select
                value={p.type}
                onChange={(e) => updateParam(i, 'type', e.target.value)}
                style={{ ...inputStyle, flex: 1 }}
              >
                {TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t} style={{ background: '#14162a' }}>
                    {t}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => removeParam(i)} style={removeBtnStyle}>
                Remove
              </button>
            </div>
          ))}
        </div>

        {/* ---- Test cases ---- */}
        <div style={cardStyle}>
          <h2 style={sectionTitleStyle}>Test cases</h2>
          <p style={sectionSubStyle}>
            Judged against every submission. Hidden cases are only judged on Submit, never shown to users.
          </p>

          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
            <span style={labelStyle}>{testCases.length} test case(s)</span>
            <div style={{ flex: 1 }} />
            <button type="button" onClick={addTestCase} style={smallBtnStyle}>
              + Add test case
            </button>
          </div>
          {testCases.map((tc, i) => (
            <div key={i} style={rowCardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#9aa2b8' }}>
                  <input
                    type="checkbox"
                    checked={tc.hidden}
                    onChange={(e) => updateTestCase(i, 'hidden', e.target.checked)}
                  />
                  Hidden
                </label>
                {testCases.length > 1 && (
                  <button type="button" onClick={() => removeTestCase(i)} style={removeBtnStyle}>
                    Remove
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <textarea
                  value={tc.input}
                  onChange={(e) => updateTestCase(i, 'input', e.target.value)}
                  placeholder="Input"
                  style={{ ...codeAreaStyle, flex: 1, minHeight: 60 }}
                />
                <textarea
                  value={tc.expectedOutput}
                  onChange={(e) => updateTestCase(i, 'expectedOutput', e.target.value)}
                  placeholder="Expected output"
                  style={{ ...codeAreaStyle, flex: 1, minHeight: 60 }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* ---- Solution: one continuous write-up ---- */}
        <div style={cardStyle}>
          <h2 style={sectionTitleStyle}>Solution</h2>
          <p style={sectionSubStyle}>
            Paste your whole write-up as one continuous piece - it doesn't need to be split into parts.
            Use a single text block for all the prose, and drop in a code block wherever code belongs;
            code always renders fenced, so you never need to type backticks yourself.
          </p>

          {solutionBlocks.map((block, bi) => (
            <div key={block.id} style={{ ...rowCardStyle, background: 'rgba(255,255,255,.03)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: '#6b7392', textTransform: 'uppercase' }}>
                  {block.kind === 'text' ? 'Text' : 'Code'}
                </span>
                <div style={{ flex: 1 }} />
                <button
                  type="button"
                  onClick={() => moveBlock(block.id, -1)}
                  disabled={bi === 0}
                  style={{ ...smallBtnStyle, opacity: bi === 0 ? 0.35 : 1, padding: '5px 9px' }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveBlock(block.id, 1)}
                  disabled={bi === solutionBlocks.length - 1}
                  style={{
                    ...smallBtnStyle,
                    opacity: bi === solutionBlocks.length - 1 ? 0.35 : 1,
                    padding: '5px 9px',
                  }}
                >
                  ↓
                </button>
                <button type="button" onClick={() => removeBlock(block.id)} style={removeBtnStyle}>
                  Remove
                </button>
              </div>

              {block.kind === 'text' ? (
                <textarea
                  value={block.content}
                  onChange={(e) => updateTextBlock(block.id, e.target.value)}
                  placeholder="Paste your write-up text here (plain text / markdown)"
                  style={{ ...textareaStyle, minHeight: 220 }}
                />
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                    <select
                      value={block.language}
                      onChange={(e) => updateCodeBlock(block.id, 'language', e.target.value)}
                      style={{ ...inputStyle, flex: 1 }}
                    >
                      {LANGUAGES.map((l) => (
                        <option key={l.id} value={l.id} style={{ background: '#14162a' }}>
                          {l.label}
                        </option>
                      ))}
                    </select>
                    <input
                      value={block.caption}
                      onChange={(e) => updateCodeBlock(block.id, 'caption', e.target.value)}
                      placeholder="Caption (optional)"
                      style={{ ...inputStyle, flex: 2 }}
                    />
                  </div>
                  <textarea
                    value={block.code}
                    onChange={(e) => updateCodeBlock(block.id, 'code', e.target.value)}
                    placeholder="Code"
                    style={{ ...codeAreaStyle, minHeight: 100 }}
                  />
                </>
              )}
            </div>
          ))}

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={addTextBlock} style={smallBtnStyle}>
              + Add text
            </button>
            <button type="button" onClick={addCodeBlock} style={smallBtnStyle}>
              + Add code block
            </button>
          </div>
        </div>

        {/* ---- Visualizer ---- */}
        <div style={cardStyle}>
          <h2 style={sectionTitleStyle}>Visualizer</h2>
          <p style={sectionSubStyle}>Optional. Paste the full self-contained HTML page.</p>
          <textarea
            value={visualizerHtml}
            onChange={(e) => setVisualizerHtml(e.target.value)}
            placeholder="<!DOCTYPE html>..."
            style={{ ...codeAreaStyle, minHeight: 160 }}
          />
        </div>

        {submitError && (
          <div
            style={{
              fontSize: 13.5,
              color: '#fca5a5',
              background: 'rgba(248,113,113,.1)',
              border: '1px solid rgba(248,113,113,.25)',
              borderRadius: 10,
              padding: '12px 14px',
              marginBottom: 20,
            }}
          >
            {submitError}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="op-auth-submit"
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: '#fff',
            background: 'linear-gradient(135deg,#7c3aed,#6366f1)',
            border: 'none',
            borderRadius: 12,
            padding: '14px 24px',
            cursor: submitting ? 'default' : 'pointer',
            opacity: submitting ? 0.6 : 1,
          }}
        >
          {submitting
            ? isEditMode
              ? 'Saving…'
              : 'Creating…'
            : isEditMode
              ? 'Save Changes'
              : 'Create Problem'}
        </button>
      </form>
      )}
    </div>
  );
}
