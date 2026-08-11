// The Practice page's "Board" view: a Whimsical-style, freeform 2D
// pan/zoom canvas. Unlike ProblemGraph3D (which auto-lays-out EVERY
// problem via a force simulation), the Board only shows nodes the user has
// explicitly placed - problems start out in the left "Unplaced" sidebar and
// only appear on the canvas once added, so the canvas reads as a
// hand-drawn mind-map ("Array" -> "Two Pointer" -> "Two Sum") rather than a
// dense point-cloud. Pattern/category nodes ("board cards") are created
// directly on the canvas. Both kinds are freely draggable; connections are
// smooth bezier curves between two node centers, drawn/removed by toggling
// "Connect" mode and clicking one node then another - same click-node,
// click-node convention ProblemGraph3D uses for its 3D edges.
//
// This view's data (board cards/connections/positions) is entirely
// separate from the 3D Graph view's - see api/boardCards.ts,
// api/boardConnections.ts, api/boardPositions.ts. Placing/arranging a
// problem here has no effect on the 3D graph, and vice versa.

import { useCallback, useMemo, useRef, useState, type CSSProperties } from 'react';
import { DIFFICULTY_COLOR, type Difficulty } from '../../data/problems';
import type { ProblemSummary } from '../../api/problems';
import type { BoardCard } from '../../api/boardCards';
import type { BoardConnection, BoardNodeRef, BoardNodeType } from '../../api/boardConnections';
import type { BoardNodePosition } from '../../api/boardPositions';

type NodeKind = 'problem' | 'card';

interface PlacedNode {
  key: string; // "p-12" / "c-3"
  kind: NodeKind;
  refId: number;
  title: string;
  color: string;
  difficulty?: string;
  solved?: boolean;
  x: number;
  y: number;
}

interface Props {
  problems: ProblemSummary[];
  cards: BoardCard[];
  connections: BoardConnection[];
  positions: BoardNodePosition[];
  solvedIds: Set<number>;
  onOpenProblem: (problemId: number) => void;
  onCreateCard: (title: string, x: number, y: number) => void;
  onRenameCard: (id: number, title: string) => void;
  onDeleteCard: (id: number) => void;
  onCreateConnection: (a: BoardNodeRef, b: BoardNodeRef) => void;
  onDeleteConnection: (id: number) => void;
  onSavePosition: (position: BoardNodePosition) => void;
  onRemoveFromBoard: (nodeType: BoardNodeType, nodeId: number) => void;
}

const nodeKeyOf = (type: BoardNodeType, id: number) => (type === 'PROBLEM' ? `p-${id}` : `c-${id}`);

// A cycling palette for new pattern cards - loosely matching the reference
// image's per-branch color-coding (each top-level pattern gets its own hue,
// making the mind-map scannable at a glance).
const CARD_PALETTE = [
  '#a78bfa', '#f472b6', '#38bdf8', '#fb923c', '#facc15', '#34d399', '#f87171', '#818cf8',
];
const paletteColorFor = (id: number) => CARD_PALETTE[id % CARD_PALETTE.length];

const MIN_SCALE = 0.25;
const MAX_SCALE = 2.5;
const DRAG_THRESHOLD_PX = 4;

export default function ProblemBoard2D({
  problems,
  cards,
  connections,
  positions,
  solvedIds,
  onOpenProblem,
  onCreateCard,
  onRenameCard,
  onDeleteCard,
  onCreateConnection,
  onDeleteConnection,
  onSavePosition,
  onRemoveFromBoard,
}: Props) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(0.85);
  const [search, setSearch] = useState('');
  const [connectMode, setConnectMode] = useState(false);
  const [armedNode, setArmedNode] = useState<string | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<number | null>(null);
  const [renamingCardId, setRenamingCardId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  // Refs (not state) for in-flight pan/drag gestures - these change every
  // mousemove frame and don't need re-renders themselves, only the x/y they
  // eventually commit to state (pan) or a callback (node drag) do.
  const panGestureRef = useRef<{ startX: number; startY: number; originPan: { x: number; y: number } } | null>(null);
  const nodeDragRef = useRef<{
    key: string;
    kind: NodeKind;
    refId: number;
    startScreenX: number;
    startScreenY: number;
    originWorld: { x: number; y: number };
    moved: boolean;
  } | null>(null);

  const positionByKey = useMemo(() => {
    const map = new Map<string, BoardNodePosition>();
    for (const p of positions) map.set(nodeKeyOf(p.nodeType, p.nodeId), p);
    return map;
  }, [positions]);

  const problemById = useMemo(() => {
    const map = new Map<number, ProblemSummary>();
    for (const p of problems) map.set(p.id, p);
    return map;
  }, [problems]);

  const cardById = useMemo(() => {
    const map = new Map<number, BoardCard>();
    for (const c of cards) map.set(c.id, c);
    return map;
  }, [cards]);

  // Only nodes with a saved position are "on the board" - this is what
  // makes Board an explicit, curated mind-map rather than an
  // everything-at-once dump like the 3D Graph view.
  const placedNodes = useMemo(() => {
    const nodes: PlacedNode[] = [];
    for (const pos of positions) {
      if (pos.nodeType === 'PROBLEM') {
        const problem = problemById.get(pos.nodeId);
        if (!problem) continue;
        nodes.push({
          key: nodeKeyOf('PROBLEM', pos.nodeId),
          kind: 'problem',
          refId: pos.nodeId,
          title: problem.name,
          color: DIFFICULTY_COLOR[problem.difficulty as Difficulty] ?? '#9aa2b8',
          difficulty: problem.difficulty,
          solved: solvedIds.has(pos.nodeId),
          x: pos.x,
          y: pos.y,
        });
      } else {
        const card = cardById.get(pos.nodeId);
        if (!card) continue;
        nodes.push({
          key: nodeKeyOf('CARD', pos.nodeId),
          kind: 'card',
          refId: pos.nodeId,
          title: card.title,
          color: card.color || paletteColorFor(card.id),
          x: pos.x,
          y: pos.y,
        });
      }
    }
    return nodes;
  }, [positions, problemById, cardById, solvedIds]);

  const nodeByKey = useMemo(() => {
    const map = new Map<string, PlacedNode>();
    for (const n of placedNodes) map.set(n.key, n);
    return map;
  }, [placedNodes]);

  // Direct-child problem count per card, for the reference image's little
  // count badge next to each pattern name.
  const childCountByCardId = useMemo(() => {
    const counts = new Map<number, number>();
    for (const conn of connections) {
      const a = conn.nodeAType === 'CARD' ? conn.nodeAId : null;
      const b = conn.nodeBType === 'CARD' ? conn.nodeBId : null;
      if (a !== null) counts.set(a, (counts.get(a) ?? 0) + 1);
      if (b !== null) counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    return counts;
  }, [connections]);

  const unplacedProblems = useMemo(() => {
    return problems
      .filter((p) => !positionByKey.has(nodeKeyOf('PROBLEM', p.id)))
      .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
  }, [problems, positionByKey, search]);

  // ---- coordinate math ----

  const screenToWorld = useCallback(
    (screenX: number, screenY: number) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      const originScreenX = rect.left + rect.width / 2 + pan.x;
      const originScreenY = rect.top + rect.height / 2 + pan.y;
      return { x: (screenX - originScreenX) / scale, y: (screenY - originScreenY) / scale };
    },
    [pan, scale],
  );

  const viewportCenterWorld = useCallback(() => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }, [screenToWorld]);

  // ---- pan (background drag) ----

  function handleBackgroundMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return;
    panGestureRef.current = { startX: e.clientX, startY: e.clientY, originPan: pan };
    setSelectedConnectionId(null);
    window.addEventListener('mousemove', handleBackgroundMouseMove);
    window.addEventListener('mouseup', handleBackgroundMouseUp);
  }

  function handleBackgroundMouseMove(e: MouseEvent) {
    const gesture = panGestureRef.current;
    if (!gesture) return;
    setPan({
      x: gesture.originPan.x + (e.clientX - gesture.startX),
      y: gesture.originPan.y + (e.clientY - gesture.startY),
    });
  }

  function handleBackgroundMouseUp() {
    panGestureRef.current = null;
    window.removeEventListener('mousemove', handleBackgroundMouseMove);
    window.removeEventListener('mouseup', handleBackgroundMouseUp);
  }

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cursorX = e.clientX;
    const cursorY = e.clientY;
    const worldUnderCursor = screenToWorld(cursorX, cursorY);
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));

    const originScreenX = cursorX - newScale * worldUnderCursor.x;
    const originScreenY = cursorY - newScale * worldUnderCursor.y;
    setScale(newScale);
    setPan({
      x: originScreenX - (rect.left + rect.width / 2),
      y: originScreenY - (rect.top + rect.height / 2),
    });
  }

  function zoomBy(factor: number) {
    setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * factor)));
  }

  function resetView() {
    setPan({ x: 0, y: 0 });
    setScale(0.85);
  }

  // ---- node drag ----

  function handleNodeMouseDown(e: React.MouseEvent, node: PlacedNode) {
    e.stopPropagation();
    if (e.button !== 0) return;
    nodeDragRef.current = {
      key: node.key,
      kind: node.kind,
      refId: node.refId,
      startScreenX: e.clientX,
      startScreenY: e.clientY,
      originWorld: { x: node.x, y: node.y },
      moved: false,
    };
    window.addEventListener('mousemove', handleNodeMouseMove);
    window.addEventListener('mouseup', handleNodeMouseUp);
  }

  const liveDragPositionRef = useRef<{ key: string; x: number; y: number } | null>(null);
  const [, forceRerender] = useState(0);

  function handleNodeMouseMove(e: MouseEvent) {
    const drag = nodeDragRef.current;
    if (!drag) return;
    const dx = (e.clientX - drag.startScreenX) / scale;
    const dy = (e.clientY - drag.startScreenY) / scale;
    if (!drag.moved && Math.hypot(e.clientX - drag.startScreenX, e.clientY - drag.startScreenY) > DRAG_THRESHOLD_PX) {
      drag.moved = true;
    }
    if (drag.moved) {
      liveDragPositionRef.current = { key: drag.key, x: drag.originWorld.x + dx, y: drag.originWorld.y + dy };
      forceRerender((n) => n + 1);
    }
  }

  function handleNodeMouseUp(e: MouseEvent) {
    const drag = nodeDragRef.current;
    nodeDragRef.current = null;
    window.removeEventListener('mousemove', handleNodeMouseMove);
    window.removeEventListener('mouseup', handleNodeMouseUp);
    if (!drag) return;

    if (drag.moved) {
      const dx = (e.clientX - drag.startScreenX) / scale;
      const dy = (e.clientY - drag.startScreenY) / scale;
      const finalX = drag.originWorld.x + dx;
      const finalY = drag.originWorld.y + dy;
      liveDragPositionRef.current = null;
      onSavePosition({
        nodeType: drag.kind === 'problem' ? 'PROBLEM' : 'CARD',
        nodeId: drag.refId,
        x: finalX,
        y: finalY,
      });
    } else {
      // A real click, not a drag - either arm/complete a connection, or
      // open the problem / start renaming the card.
      handleNodeClick(drag.kind, drag.refId, drag.key);
    }
  }

  function handleNodeClick(kind: NodeKind, refId: number, key: string) {
    if (connectMode) {
      if (!armedNode) {
        setArmedNode(key);
        return;
      }
      if (armedNode === key) {
        setArmedNode(null);
        return;
      }
      const armed = nodeByKey.get(armedNode);
      if (armed) {
        onCreateConnection(
          { type: armed.kind === 'problem' ? 'PROBLEM' : 'CARD', id: armed.refId },
          { type: kind === 'problem' ? 'PROBLEM' : 'CARD', id: refId },
        );
      }
      setArmedNode(null);
      return;
    }

    if (kind === 'problem') {
      onOpenProblem(refId);
    } else {
      const card = cardById.get(refId);
      setRenamingCardId(refId);
      setRenameDraft(card?.title ?? '');
    }
  }

  function commitRename() {
    if (renamingCardId == null) return;
    const title = renameDraft.trim();
    if (title) onRenameCard(renamingCardId, title);
    setRenamingCardId(null);
  }

  // ---- creating a new pattern card, centered in the current viewport ----

  function handleAddCard() {
    const title = window.prompt('Pattern / category name (e.g. "Sliding Window")');
    const trimmed = title?.trim();
    if (!trimmed) return;
    const center = viewportCenterWorld();
    onCreateCard(trimmed, center.x, center.y);
  }

  function handleAddProblem(problemId: number) {
    const center = viewportCenterWorld();
    // Small random jitter so repeatedly adding problems doesn't stack every
    // node exactly on top of the last one.
    const jitterX = (Math.random() - 0.5) * 60;
    const jitterY = (Math.random() - 0.5) * 60;
    onSavePosition({ nodeType: 'PROBLEM', nodeId: problemId, x: center.x + jitterX, y: center.y + jitterY });
  }

  // ---- rendering ----

  const worldTransform: CSSProperties = {
    position: 'absolute',
    left: '50%',
    top: '50%',
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
    transformOrigin: '0 0',
  };

  function resolvedPosition(node: PlacedNode) {
    const live = liveDragPositionRef.current;
    if (live && live.key === node.key) return { x: live.x, y: live.y };
    return { x: node.x, y: node.y };
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex' }}>
      {/* ---- Left sidebar: unplaced problems, added to the board on click ---- */}
      <aside
        style={{
          width: 240,
          flexShrink: 0,
          borderRight: '1px solid rgba(255,255,255,.08)',
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(255,255,255,.02)',
        }}
      >
        <div style={{ padding: '14px 14px 8px' }}>
          <div
            style={{
              fontFamily: "'JetBrains Mono',monospace",
              fontSize: 10.5,
              letterSpacing: '.12em',
              color: '#6b7392',
              textTransform: 'uppercase',
              marginBottom: 8,
            }}
          >
            Unplaced ({unplacedProblems.length})
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,.12)',
              background: 'rgba(255,255,255,.04)',
              color: '#eef0f6',
              fontSize: 12.5,
              fontFamily: 'inherit',
              outline: 'none',
            }}
          />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 12px' }}>
          {unplacedProblems.map((p) => (
            <button
              key={p.id}
              onClick={() => handleAddProblem(p.id)}
              title="Add to board"
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                textAlign: 'left',
                fontFamily: 'inherit',
                fontSize: 12.5,
                color: '#cdd3e0',
                background: 'transparent',
                border: 'none',
                borderRadius: 8,
                padding: '8px 8px',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,.05)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 999,
                  flexShrink: 0,
                  background: DIFFICULTY_COLOR[p.difficulty as Difficulty] ?? '#9aa2b8',
                }}
              />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.name}
              </span>
              <span style={{ color: '#6b7392', fontSize: 14, flexShrink: 0 }}>+</span>
            </button>
          ))}
          {unplacedProblems.length === 0 && (
            <div style={{ padding: '20px 10px', color: '#6b7392', fontSize: 12.5, textAlign: 'center' }}>
              Everything's on the board.
            </div>
          )}
        </div>
      </aside>

      {/* ---- Canvas ---- */}
      <div style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden' }}>
        {/* Toolbar */}
        <div
          style={{
            position: 'absolute',
            top: 14,
            left: 14,
            zIndex: 5,
            display: 'flex',
            gap: 8,
          }}
        >
          <button onClick={handleAddCard} className="op-btn-primary" style={toolbarPrimaryBtnStyle}>
            + Pattern
          </button>
          <button
            onClick={() => {
              setConnectMode((v) => !v);
              setArmedNode(null);
            }}
            style={{
              ...toolbarBtnStyle,
              borderColor: connectMode ? 'rgba(167,139,250,.6)' : 'rgba(255,255,255,.14)',
              background: connectMode ? 'rgba(124,58,237,.22)' : 'rgba(255,255,255,.04)',
              color: connectMode ? '#c4b5fd' : '#cdd3e0',
            }}
          >
            {connectMode ? (armedNode ? 'Pick target node…' : 'Connecting… (Esc to cancel)') : '🔗 Connect'}
          </button>
          {connectMode && (
            <button
              onClick={() => {
                setConnectMode(false);
                setArmedNode(null);
              }}
              style={toolbarBtnStyle}
            >
              Done
            </button>
          )}
        </div>

        <div
          style={{
            position: 'absolute',
            top: 14,
            right: 14,
            zIndex: 5,
            display: 'flex',
            gap: 6,
          }}
        >
          <button onClick={() => zoomBy(1 / 1.2)} style={toolbarBtnStyle}>
            −
          </button>
          <button onClick={resetView} style={toolbarBtnStyle}>
            Reset
          </button>
          <button onClick={() => zoomBy(1.2)} style={toolbarBtnStyle}>
            +
          </button>
        </div>

        <div
          ref={viewportRef}
          onMouseDown={handleBackgroundMouseDown}
          onWheel={handleWheel}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setConnectMode(false);
              setArmedNode(null);
            }
          }}
          tabIndex={0}
          style={{
            width: '100%',
            height: '100%',
            position: 'relative',
            overflow: 'hidden',
            cursor: panGestureRef.current ? 'grabbing' : 'grab',
            background:
              'radial-gradient(circle, rgba(255,255,255,.05) 1px, transparent 1px) 0 0/28px 28px, #080a14',
            outline: 'none',
          }}
        >
          <div style={worldTransform}>
            {/* Connector lines */}
            <svg style={{ position: 'absolute', overflow: 'visible', left: 0, top: 0, pointerEvents: 'none' }}>
              {connections.map((conn) => {
                const a = nodeByKey.get(nodeKeyOf(conn.nodeAType, conn.nodeAId));
                const b = nodeByKey.get(nodeKeyOf(conn.nodeBType, conn.nodeBId));
                if (!a || !b) return null;
                const pa = resolvedPosition(a);
                const pb = resolvedPosition(b);
                const midX = (pa.x + pb.x) / 2;
                const color = conn.color || a.color || '#7c8cf8';
                const selected = selectedConnectionId === conn.id;
                return (
                  <g key={conn.id}>
                    <path
                      d={`M ${pa.x} ${pa.y} C ${midX} ${pa.y}, ${midX} ${pb.y}, ${pb.x} ${pb.y}`}
                      fill="none"
                      stroke={color}
                      strokeWidth={selected ? 3 : 2}
                      opacity={selected ? 0.95 : 0.55}
                      style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        setSelectedConnectionId(conn.id);
                      }}
                    />
                    {selected && (
                      <foreignObject x={midX - 11} y={(pa.y + pb.y) / 2 - 11} width={22} height={22}>
                        <button
                          onClick={() => {
                            onDeleteConnection(conn.id);
                            setSelectedConnectionId(null);
                          }}
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: 999,
                            border: '1px solid rgba(248,113,113,.5)',
                            background: '#1a1024',
                            color: '#fca5a5',
                            fontSize: 12,
                            lineHeight: '1',
                            cursor: 'pointer',
                          }}
                        >
                          ×
                        </button>
                      </foreignObject>
                    )}
                  </g>
                );
              })}
              {connectMode && armedNode && nodeByKey.get(armedNode) && (
                <circle
                  cx={resolvedPosition(nodeByKey.get(armedNode)!).x}
                  cy={resolvedPosition(nodeByKey.get(armedNode)!).y}
                  r={28}
                  fill="none"
                  stroke="#c4b5fd"
                  strokeDasharray="4 4"
                />
              )}
            </svg>

            {/* Nodes */}
            {placedNodes.map((node) => {
              const pos = resolvedPosition(node);
              const isArmed = armedNode === node.key;
              const isRenaming = node.kind === 'card' && renamingCardId === node.refId;

              if (node.kind === 'card') {
                const count = childCountByCardId.get(node.refId) ?? 0;
                return (
                  <div
                    key={node.key}
                    onMouseDown={(e) => handleNodeMouseDown(e, node)}
                    style={{
                      position: 'absolute',
                      left: pos.x,
                      top: pos.y,
                      transform: 'translate(-50%, -50%)',
                      minWidth: 150,
                      padding: '10px 14px',
                      borderRadius: 12,
                      background: '#141626',
                      border: `1.5px solid ${isArmed ? '#c4b5fd' : node.color}`,
                      boxShadow: isArmed ? '0 0 0 3px rgba(167,139,250,.25)' : '0 4px 14px rgba(0,0,0,.35)',
                      cursor: connectMode ? 'crosshair' : 'grab',
                      userSelect: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                    className="op-board-node"
                  >
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: node.color, flexShrink: 0 }} />
                    {isRenaming ? (
                      <input
                        autoFocus
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename();
                          if (e.key === 'Escape') setRenamingCardId(null);
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        style={{
                          fontFamily: 'inherit',
                          fontSize: 13.5,
                          fontWeight: 700,
                          background: 'transparent',
                          border: 'none',
                          borderBottom: '1px solid rgba(255,255,255,.3)',
                          color: '#eef0f6',
                          outline: 'none',
                          width: 120,
                        }}
                      />
                    ) : (
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: '#eef0f6', whiteSpace: 'nowrap' }}>
                        {node.title}
                      </span>
                    )}
                    {count > 0 && (
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: 700,
                          color: '#0a0c16',
                          background: node.color,
                          borderRadius: 999,
                          padding: '1px 6px',
                        }}
                      >
                        {count}
                      </span>
                    )}
                    <button
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => onDeleteCard(node.refId)}
                      className="op-board-node-delete"
                      title="Delete pattern"
                      style={{
                        marginLeft: 2,
                        width: 16,
                        height: 16,
                        borderRadius: 999,
                        border: 'none',
                        background: 'transparent',
                        color: '#6b7392',
                        fontSize: 12,
                        lineHeight: '1',
                        cursor: 'pointer',
                      }}
                    >
                      ×
                    </button>
                  </div>
                );
              }

              // Problem leaf node.
              return (
                <div
                  key={node.key}
                  onMouseDown={(e) => handleNodeMouseDown(e, node)}
                  style={{
                    position: 'absolute',
                    left: pos.x,
                    top: pos.y,
                    transform: 'translate(-50%, -50%)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    padding: '7px 12px',
                    borderRadius: 999,
                    background: node.solved ? 'rgba(52,211,153,.12)' : '#10121e',
                    border: `1.5px solid ${isArmed ? '#c4b5fd' : node.solved ? 'rgba(52,211,153,.5)' : 'rgba(255,255,255,.14)'}`,
                    boxShadow: isArmed ? '0 0 0 3px rgba(167,139,250,.25)' : '0 3px 10px rgba(0,0,0,.3)',
                    cursor: connectMode ? 'crosshair' : 'pointer',
                    userSelect: 'none',
                    whiteSpace: 'nowrap',
                  }}
                  className="op-board-node"
                >
                  <span style={{ width: 7, height: 7, borderRadius: 999, background: node.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: '#eef0f6' }}>
                    {node.solved ? '✓ ' : ''}
                    {node.title}
                  </span>
                  <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => onRemoveFromBoard('PROBLEM', node.refId)}
                    className="op-board-node-delete"
                    title="Remove from board"
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 999,
                      border: 'none',
                      background: 'transparent',
                      color: '#6b7392',
                      fontSize: 11,
                      lineHeight: '1',
                      cursor: 'pointer',
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

const toolbarBtnStyle: CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 12.5,
  fontWeight: 600,
  padding: '9px 14px',
  borderRadius: 9,
  border: '1px solid rgba(255,255,255,.14)',
  background: 'rgba(20,22,38,.9)',
  color: '#cdd3e0',
  cursor: 'pointer',
  backdropFilter: 'blur(6px)',
};

const toolbarPrimaryBtnStyle: CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 12.5,
  fontWeight: 700,
  padding: '9px 14px',
  borderRadius: 9,
  border: '1px solid transparent',
  color: '#0a0c16',
  background: '#fff',
  cursor: 'pointer',
};
