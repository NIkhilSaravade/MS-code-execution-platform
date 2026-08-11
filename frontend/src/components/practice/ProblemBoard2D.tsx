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
  // Card-only manual size override (see the corner resize handle) -
  // undefined means "use the default sizing".
  // Card-only manual size/font override, as a 1-10 level (see
  // SIZE_LEVELS/FONT_LEVELS) - undefined means "use the default level".
  sizeLevel?: number;
  fontLevel?: number;
}

interface Props {
  // The board is one shared, curated resource now (see problem-service's
  // BoardCardController comment) - a plain USER only ever views it: open a
  // problem, collapse/expand a branch. Every other affordance here (create/
  // rename/resize/delete/connect/disconnect/drag-to-move/pin-as-root) is
  // gated behind this and additionally enforced server-side (ADMIN-only on
  // every write endpoint), so hiding it here is a UX nicety, not the real
  // security boundary.
  isAdmin: boolean;
  problems: ProblemSummary[];
  cards: BoardCard[];
  connections: BoardConnection[];
  positions: BoardNodePosition[];
  solvedIds: Set<number>;
  onOpenProblem: (problemId: number) => void;
  // Returns the created card's id (or undefined on failure) - see
  // handleAddCard, which uses it to immediately enter rename mode.
  onCreateCard: (title: string, x: number, y: number) => Promise<number | undefined>;
  onRenameCard: (id: number, title: string) => void;
  onResizeCard: (id: number, sizeLevel: number, fontLevel: number) => void;
  onDeleteCard: (id: number) => void;
  onCreateConnection: (a: BoardNodeRef, b: BoardNodeRef) => void;
  onDeleteConnection: (id: number) => void;
  onSavePosition: (position: BoardNodePosition) => void;
  onRemoveFromBoard: (nodeType: BoardNodeType, nodeId: number) => void;
}

const nodeKeyOf = (type: BoardNodeType, id: number) => (type === 'PROBLEM' ? `p-${id}` : `c-${id}`);

// Which node "wins" as the top of its branch when turning the (undirected)
// connection graph into a collapsible tree is fundamentally ambiguous - a
// connection carries no parent/child direction, so it's guessed
// structurally (see childrenOf below). That guess can be wrong for a
// deliberately-built hierarchy (e.g. an overarching "DSA" card meant to sit
// above "Array", even though "Array" is structurally more central in the
// graph) - pinning a node as a root overrides the guess for its whole
// connected component. Stored in localStorage (per browser, not synced
// across devices) since it's a display preference, not real board data.
const PINNED_ROOTS_STORAGE_KEY = 'op-board-pinned-roots';

function getStoredPinnedRoots(): Set<string> {
  try {
    const stored = localStorage.getItem(PINNED_ROOTS_STORAGE_KEY);
    if (stored) return new Set(JSON.parse(stored));
  } catch {
    // localStorage unavailable, or corrupt JSON - fall back to "nothing pinned".
  }
  return new Set();
}

// A cycling palette for new pattern cards - loosely matching the reference
// image's per-branch color-coding (each top-level pattern gets its own hue,
// making the mind-map scannable at a glance).
const CARD_PALETTE = [
  '#a78bfa', '#f472b6', '#38bdf8', '#fb923c', '#facc15', '#34d399', '#f87171', '#818cf8',
];
const paletteColorFor = (id: number) => CARD_PALETTE[id % CARD_PALETTE.length];

// A card's box size and title font size are each an explicit 1-10 "level"
// (persisted as sizeLevel/fontLevel), not raw pixels - dragging the corner
// handle or clicking the font +/- steps through these, and a live "Level N"
// label shows which one you're on, rather than a pixel count that's hard to
// reason about ("is 340px bigger or smaller than what I had before?").
// DEFAULT_LEVEL (5) is what a never-resized card uses.
const DEFAULT_LEVEL = 5;
const SIZE_LEVELS: { width: number; height: number }[] = [
  { width: 140, height: 44 }, // 1
  { width: 160, height: 46 }, // 2
  { width: 175, height: 48 }, // 3
  { width: 190, height: 50 }, // 4
  { width: 210, height: 54 }, // 5 (default)
  { width: 230, height: 58 }, // 6
  { width: 255, height: 64 }, // 7
  { width: 285, height: 70 }, // 8
  { width: 320, height: 78 }, // 9
  { width: 360, height: 88 }, // 10
];
const FONT_LEVELS: number[] = [11, 12, 13, 14, 16, 17, 18, 20, 22, 24]; // px, index 0 = level 1

function sizeForLevel(level: number | undefined) {
  return SIZE_LEVELS[(level ?? DEFAULT_LEVEL) - 1] ?? SIZE_LEVELS[DEFAULT_LEVEL - 1];
}
function fontPxForLevel(level: number | undefined) {
  return FONT_LEVELS[(level ?? DEFAULT_LEVEL) - 1] ?? FONT_LEVELS[DEFAULT_LEVEL - 1];
}
function clampLevel(level: number) {
  return Math.max(1, Math.min(SIZE_LEVELS.length, level));
}

// MIN_SCALE was 0.25 - fine for a handful of nodes, but far too limited
// once a board grows into dozens of cards spanning thousands of world
// units (a real hand-built mind-map, not a toy example) - zooming out
// maxed out well before the whole tree fit on screen.
const MIN_SCALE = 0.05;
const MAX_SCALE = 2.5;
const DRAG_THRESHOLD_PX = 4;

export default function ProblemBoard2D({
  isAdmin,
  problems,
  cards,
  connections,
  positions,
  solvedIds,
  onOpenProblem,
  onCreateCard,
  onRenameCard,
  onResizeCard,
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
  // Disconnect mode is the mirror image of Connect mode - same click-node,
  // click-node gesture, but removes the edge between the two instead of
  // adding one. Shares `armedNode` with Connect mode since only one of the
  // two is ever active at a time (toggling either one off the other, see
  // the toolbar buttons below).
  const [disconnectMode, setDisconnectMode] = useState(false);
  const [armedNode, setArmedNode] = useState<string | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<number | null>(null);
  const [renamingCardId, setRenamingCardId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  // Node keys the user has collapsed - see childrenOf/hiddenKeys below for
  // how this turns into "everything under a collapsed node is hidden".
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(new Set());
  // See PINNED_ROOTS_STORAGE_KEY's comment - overrides the automatic
  // root-detection heuristic for whichever node(s) are pinned here.
  const [pinnedRootKeys, setPinnedRootKeys] = useState<Set<string>>(getStoredPinnedRoots);

  function togglePinnedRoot(key: string) {
    setPinnedRootKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      try {
        localStorage.setItem(PINNED_ROOTS_STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // Best-effort persistence, same as elsewhere - a storage failure
        // shouldn't block pinning for the current session.
      }
      return next;
    });
  }

  // Which card the mouse is currently over - drives the resize handle's
  // hover-to-reveal (see the handle's render below), so it's not cluttering
  // every card all the time.
  const [hoveredCardKey, setHoveredCardKey] = useState<string | null>(null);

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
          sizeLevel: card.sizeLevel ?? undefined,
          fontLevel: card.fontLevel ?? undefined,
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

  // Undirected adjacency straight from the connections - a connection has
  // no inherent "parent"/"child" side (BoardConnection just stores a
  // canonicalized, direction-less pair), so this alone doesn't say which
  // way is "down" for collapsing.
  const adjacency = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const n of placedNodes) map.set(n.key, []);
    for (const conn of connections) {
      const aKey = nodeKeyOf(conn.nodeAType, conn.nodeAId);
      const bKey = nodeKeyOf(conn.nodeBType, conn.nodeBId);
      if (!map.has(aKey) || !map.has(bKey)) continue;
      map.get(aKey)!.push(bKey);
      map.get(bKey)!.push(aKey);
    }
    return map;
  }, [placedNodes, connections]);

  // Turns the undirected connection graph into a rooted forest (parent ->
  // children) by picking a deterministic root per connected component and
  // doing a BFS out from it. For an actual tree (no cycles - the normal
  // case for a hand-built mind-map) this gives the exact, unambiguous
  // parent/child relationship "click a node, hide what's under it" needs.
  // A graph with an extra edge (a rare cycle) just silently picks one of
  // the two paths as the tree edge - no crash, no infinite loop, just one
  // fewer edge shown as expandable.
  //
  // Root preference, in order: an explicitly pinned node first (see
  // pinnedRootKeys/togglePinnedRoot - this is the escape hatch for when the
  // structural guess below picks the wrong node, e.g. an overarching "DSA"
  // card that's less structurally central than "Array" but is still meant
  // to be its parent), then a card node (cards are the "pattern/category"
  // hubs users build trees from), tie-broken by key so the choice doesn't
  // jitter across renders when nothing is pinned.
  const childrenOf = useMemo(() => {
    const children = new Map<string, string[]>();
    for (const n of placedNodes) children.set(n.key, []);
    const visited = new Set<string>();

    const roots = [...adjacency.keys()].sort((a, b) => {
      const aPinned = pinnedRootKeys.has(a) ? 0 : 1;
      const bPinned = pinnedRootKeys.has(b) ? 0 : 1;
      if (aPinned !== bPinned) return aPinned - bPinned;
      const aIsCard = nodeByKey.get(a)?.kind === 'card' ? 0 : 1;
      const bIsCard = nodeByKey.get(b)?.kind === 'card' ? 0 : 1;
      if (aIsCard !== bIsCard) return aIsCard - bIsCard;
      return a.localeCompare(b);
    });

    for (const root of roots) {
      if (visited.has(root)) continue;
      visited.add(root);
      const queue = [root];
      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const neighbor of adjacency.get(current) ?? []) {
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          children.get(current)!.push(neighbor);
          queue.push(neighbor);
        }
      }
    }
    return children;
  }, [adjacency, placedNodes, nodeByKey, pinnedRootKeys]);

  // Every node hidden by a collapsed ancestor - a node with no children of
  // its own (e.g. a leaf problem) is simply never collapsible, see the
  // expand/collapse toggle button below.
  const hiddenKeys = useMemo(() => {
    const hidden = new Set<string>();
    function hideDescendants(key: string) {
      for (const child of childrenOf.get(key) ?? []) {
        if (hidden.has(child)) continue;
        hidden.add(child);
        hideDescendants(child);
      }
    }
    for (const key of collapsedKeys) {
      hideDescendants(key);
    }
    return hidden;
  }, [collapsedKeys, childrenOf]);

  function toggleCollapse(key: string) {
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

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

  // Zooms/pans so every currently-visible (not collapsed-away) node fits on
  // screen at once - much more useful than manually scrolling out once a
  // board has grown into dozens of cards spanning thousands of world units,
  // which is exactly when "just raise the zoom-out limit" stops being
  // enough on its own.
  function fitToView() {
    const rect = viewportRef.current?.getBoundingClientRect();
    const visible = placedNodes.filter((n) => !hiddenKeys.has(n.key));
    if (!rect || visible.length === 0) {
      resetView();
      return;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of visible) {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y);
    }

    // Padding accounts for node boxes/toolbar overlays extending beyond
    // their center point - without it, edge nodes would sit flush against
    // the viewport border.
    const PADDING = 140;
    const boxWidth = Math.max(maxX - minX, 1) + PADDING * 2;
    const boxHeight = Math.max(maxY - minY, 1) + PADDING * 2;
    const newScale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, Math.min(rect.width / boxWidth, rect.height / boxHeight)),
    );

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    setScale(newScale);
    setPan({ x: -centerX * newScale, y: -centerY * newScale });
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
    // Non-admin: never treat this as a drag - see the problem node's
    // onMouseDown comment below, unconditionally armed there so a plain
    // click still opens the problem, with dragging suppressed here instead.
    if (isAdmin && !drag.moved && Math.hypot(e.clientX - drag.startScreenX, e.clientY - drag.startScreenY) > DRAG_THRESHOLD_PX) {
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

  // ---- card resize (drag handle on the bottom-right corner) ----
  // Diagonal, not a single edge - drags the box's overall size level (both
  // width and height together) rather than just stretching it sideways.
  // Steps through SIZE_LEVELS (1-10) rather than raw pixels, so a live
  // "Level N" label (see the tooltip render below) always tells you exactly
  // which one you're on - the whole point being it's a level you can name,
  // not an arbitrary pixel count.

  const PX_PER_LEVEL_STEP = 30; // how much corner drag distance = one level
  const resizeDragRef = useRef<{
    id: number;
    key: string;
    startScreenX: number;
    startScreenY: number;
    originLevel: number;
  } | null>(null);
  const liveResizeLevelRef = useRef<{ key: string; level: number } | null>(null);

  function computeResizedLevel(drag: NonNullable<typeof resizeDragRef.current>, clientX: number, clientY: number) {
    const dx = (clientX - drag.startScreenX) / scale;
    const dy = (clientY - drag.startScreenY) / scale;
    // Whichever axis moved further drives the level - dragging purely right
    // or purely down both grow the box, rather than needing a diagonal
    // motion that exactly matches the box's own aspect ratio.
    const steps = Math.round(Math.max(dx, dy) / PX_PER_LEVEL_STEP);
    return clampLevel(drag.originLevel + steps);
  }

  function handleResizeMouseDown(e: React.MouseEvent, node: PlacedNode) {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0) return;
    resizeDragRef.current = {
      id: node.refId,
      key: node.key,
      startScreenX: e.clientX,
      startScreenY: e.clientY,
      originLevel: node.sizeLevel ?? DEFAULT_LEVEL,
    };
    window.addEventListener('mousemove', handleResizeMouseMove);
    window.addEventListener('mouseup', handleResizeMouseUp);
  }

  function handleResizeMouseMove(e: MouseEvent) {
    const drag = resizeDragRef.current;
    if (!drag) return;
    const level = computeResizedLevel(drag, e.clientX, e.clientY);
    liveResizeLevelRef.current = { key: drag.key, level };
    forceRerender((n) => n + 1);
  }

  function handleResizeMouseUp(e: MouseEvent) {
    const drag = resizeDragRef.current;
    resizeDragRef.current = null;
    window.removeEventListener('mousemove', handleResizeMouseMove);
    window.removeEventListener('mouseup', handleResizeMouseUp);
    if (!drag) return;
    const level = computeResizedLevel(drag, e.clientX, e.clientY);
    liveResizeLevelRef.current = null;
    const node = nodeByKey.get(drag.key);
    onResizeCard(drag.id, level, node?.fontLevel ?? DEFAULT_LEVEL);
  }

  // Font +/- - independent of box-size resizing, see the small "A-"/"A+"
  // buttons on the card render below.
  function adjustFontLevel(node: PlacedNode, delta: number) {
    const nextFontLevel = clampLevel((node.fontLevel ?? DEFAULT_LEVEL) + delta);
    onResizeCard(node.refId, node.sizeLevel ?? DEFAULT_LEVEL, nextFontLevel);
  }

  // Finds the existing connection between two node refs, regardless of
  // which one landed as nodeA/nodeB on the backend's canonicalized pair
  // (see BoardConnectionService.isCanonicalOrder) - Disconnect mode doesn't
  // know or care which side is which, just whether an edge exists at all.
  function findConnectionBetween(a: BoardNodeRef, b: BoardNodeRef) {
    return connections.find(
      (c) =>
        (c.nodeAType === a.type && c.nodeAId === a.id && c.nodeBType === b.type && c.nodeBId === b.id) ||
        (c.nodeAType === b.type && c.nodeAId === b.id && c.nodeBType === a.type && c.nodeBId === a.id),
    );
  }

  function handleNodeClick(kind: NodeKind, refId: number, key: string) {
    if (connectMode || disconnectMode) {
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
        const armedRef: BoardNodeRef = { type: armed.kind === 'problem' ? 'PROBLEM' : 'CARD', id: armed.refId };
        const targetRef: BoardNodeRef = { type: kind === 'problem' ? 'PROBLEM' : 'CARD', id: refId };
        if (connectMode) {
          onCreateConnection(armedRef, targetRef);
        } else {
          const existing = findConnectionBetween(armedRef, targetRef);
          if (existing) onDeleteConnection(existing.id);
        }
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

  // No upfront naming popup - the card is created immediately with a
  // placeholder title, dropped straight into rename mode (same inline
  // rename used everywhere else), and the user can move/rename/edit it
  // freely from there.
  const DEFAULT_CARD_TITLE = 'New pattern';

  async function handleAddCard() {
    const center = viewportCenterWorld();
    const newId = await onCreateCard(DEFAULT_CARD_TITLE, center.x, center.y);
    if (newId != null) {
      setRenamingCardId(newId);
      setRenameDraft(DEFAULT_CARD_TITLE);
    }
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
      {/* ---- Left sidebar: unplaced problems, added to the board on click.
          Admin-only - adding a problem to the board is a write against the
          one shared board, same as everything else in the toolbar. ---- */}
      {isAdmin && (
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
      )}

      {/* ---- Canvas ---- */}
      <div style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden' }}>
        {/* Toolbar - every button here writes to the shared board, so the
            whole thing is admin-only; a plain user gets no edit affordances
            at all beyond the collapse chevrons on the nodes themselves. */}
        {isAdmin && (
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
                setDisconnectMode(false);
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
            <button
              onClick={() => {
                setDisconnectMode((v) => !v);
                setConnectMode(false);
                setArmedNode(null);
              }}
              style={{
                ...toolbarBtnStyle,
                borderColor: disconnectMode ? 'rgba(248,113,113,.6)' : 'rgba(255,255,255,.14)',
                background: disconnectMode ? 'rgba(248,113,113,.16)' : 'rgba(255,255,255,.04)',
                color: disconnectMode ? '#fca5a5' : '#cdd3e0',
              }}
            >
              {disconnectMode ? (armedNode ? 'Pick node to disconnect…' : 'Disconnecting… (Esc to cancel)') : '✂️ Disconnect'}
            </button>
            {(connectMode || disconnectMode) && (
              <button
                onClick={() => {
                  setConnectMode(false);
                  setDisconnectMode(false);
                  setArmedNode(null);
                }}
                style={toolbarBtnStyle}
              >
                Done
              </button>
            )}
          </div>
        )}

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
          <button onClick={fitToView} style={toolbarBtnStyle} title="Zoom/pan to fit everything on screen">
            Fit
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
              setDisconnectMode(false);
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
            // Deliberately darker than the page background (#080a14 - see
            // PracticePage.tsx) so the canvas itself reads as a distinct
            // surface rather than blending into the rest of the page.
            background:
              'radial-gradient(circle, rgba(255,255,255,.05) 1px, transparent 1px) 0 0/28px 28px, #020309',
            outline: 'none',
          }}
        >
          <div style={worldTransform}>
            {/* Connector lines */}
            <svg style={{ position: 'absolute', overflow: 'visible', left: 0, top: 0, pointerEvents: 'none' }}>
              {connections.map((conn) => {
                const aKey = nodeKeyOf(conn.nodeAType, conn.nodeAId);
                const bKey = nodeKeyOf(conn.nodeBType, conn.nodeBId);
                // Skip an edge into/out of a collapsed subtree entirely -
                // otherwise it'd draw a dangling line to a node that isn't
                // rendered anymore.
                if (hiddenKeys.has(aKey) || hiddenKeys.has(bKey)) return null;
                const a = nodeByKey.get(aKey);
                const b = nodeByKey.get(bKey);
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
                  </g>
                );
              })}
              {(connectMode || disconnectMode) && armedNode && nodeByKey.get(armedNode) && (
                <circle
                  cx={resolvedPosition(nodeByKey.get(armedNode)!).x}
                  cy={resolvedPosition(nodeByKey.get(armedNode)!).y}
                  r={28}
                  fill="none"
                  stroke={disconnectMode ? '#f87171' : '#c4b5fd'}
                  strokeDasharray="4 4"
                />
              )}
            </svg>

            {/* Nodes */}
            {placedNodes.map((node) => {
              if (hiddenKeys.has(node.key)) return null;

              const pos = resolvedPosition(node);
              const isArmed = armedNode === node.key;
              // Red while armed for Disconnect (matches the dashed selection
              // ring's color), purple for Connect - so which gesture you're
              // mid-way through stays visually obvious on the node itself,
              // not just the toolbar/ring.
              const armedColor = disconnectMode ? '#f87171' : '#c4b5fd';
              const armedGlow = disconnectMode ? 'rgba(248,113,113,.25)' : 'rgba(167,139,250,.25)';
              const isRenaming = node.kind === 'card' && renamingCardId === node.refId;
              const childKeys = childrenOf.get(node.key) ?? [];
              const isCollapsed = collapsedKeys.has(node.key);

              // Click-to-expand/collapse toggle - only rendered for nodes
              // that actually have children (a leaf problem never gets one).
              // preventDefault + stopPropagation for the same reason as the
              // rename-delete button above: this sits on a draggable node
              // and, for cards, next to a focusable rename input, so a bare
              // stopPropagation alone wouldn't stop the browser's own
              // default mousedown-triggered focus/blur or drag-arm behavior.
              const collapseToggle =
                childKeys.length > 0 ? (
                  <button
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={() => toggleCollapse(node.key)}
                    title={isCollapsed ? `Expand (${childKeys.length})` : 'Collapse'}
                    style={{
                      width: 16,
                      height: 16,
                      flexShrink: 0,
                      borderRadius: 4,
                      // A dark chip with light text regardless of the parent
                      // node's own background - problem nodes are light now
                      // (see below), card nodes stay dark, and this needs to
                      // read clearly against both rather than being tuned
                      // for just one.
                      border: '1px solid rgba(255,255,255,.25)',
                      background: 'rgba(10,12,22,.55)',
                      color: '#eef0f6',
                      fontSize: 9,
                      lineHeight: '1',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {isCollapsed ? '▸' : '▾'}
                  </button>
                ) : null;

              // "Pin as root" - only meaningful for a connected node (an
              // isolated one has no branch to be the top of). See
              // PINNED_ROOTS_STORAGE_KEY's comment for why this exists: the
              // structural root-guess can be wrong for a deliberately-built
              // hierarchy, and this is the override.
              const isPinnedRoot = pinnedRootKeys.has(node.key);
              const pinToggle =
                isAdmin && (adjacency.get(node.key)?.length ?? 0) > 0 ? (
                  <button
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={() => togglePinnedRoot(node.key)}
                    title={isPinnedRoot ? 'Unpin as root' : 'Pin as root of its branch'}
                    style={{
                      width: 16,
                      height: 16,
                      flexShrink: 0,
                      borderRadius: 4,
                      border: `1px solid ${isPinnedRoot ? 'rgba(253,224,71,.7)' : 'rgba(255,255,255,.25)'}`,
                      background: isPinnedRoot ? 'rgba(253,224,71,.25)' : 'rgba(10,12,22,.55)',
                      color: isPinnedRoot ? '#fde047' : '#eef0f6',
                      fontSize: 9,
                      lineHeight: '1',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    📌
                  </button>
                ) : null;

              if (node.kind === 'card') {
                const count = childCountByCardId.get(node.refId) ?? 0;
                const isResizingThis = resizeDragRef.current?.key === node.key;
                const liveLevel = liveResizeLevelRef.current?.key === node.key ? liveResizeLevelRef.current.level : null;
                const displayedSizeLevel = liveLevel ?? node.sizeLevel ?? DEFAULT_LEVEL;
                const { width: displayedWidth, height: displayedHeight } = sizeForLevel(displayedSizeLevel);
                const displayedFontPx = fontPxForLevel(node.fontLevel);
                return (
                  <div
                    key={node.key}
                    onMouseDown={(e) => (isAdmin ? handleNodeMouseDown(e, node) : undefined)}
                    onClick={() => {
                      // Non-admin: the card body itself does nothing (no
                      // rename, no drag) - only the always-visible collapse
                      // chevron is interactive for a plain USER.
                    }}
                    onMouseEnter={() => setHoveredCardKey(node.key)}
                    onMouseLeave={() => setHoveredCardKey((k) => (k === node.key ? null : k))}
                    style={{
                      position: 'absolute',
                      left: pos.x,
                      top: pos.y,
                      transform: 'translate(-50%, -50%)',
                      width: displayedWidth,
                      height: displayedHeight,
                      boxSizing: 'border-box',
                      padding: '14px 18px',
                      // Squared corners (vs. problem nodes' pill shape below)
                      // are still the shape-based kind distinction, but the
                      // border itself now matches problem nodes' weight/style
                      // exactly (solid, 2px) - only its color changes state:
                      // purple while armed for a connection, amber/highlighted
                      // while collapsed (so a collapsed subtree's root stays
                      // visually flagged even once you've moved on), and the
                      // node's own color otherwise.
                      borderRadius: 8,
                      background: '#181c30',
                      border: `${isCollapsed && !isArmed ? 3 : 2}px solid ${isArmed ? armedColor : isCollapsed ? '#fde047' : node.color}`,
                      boxShadow: isArmed
                        ? `0 0 0 3px ${armedGlow}`
                        : isCollapsed
                          ? '0 0 0 4px rgba(253,224,71,.55), 0 0 18px rgba(253,224,71,.55)'
                          : '0 4px 14px rgba(0,0,0,.35)',
                      cursor: connectMode || disconnectMode ? 'crosshair' : 'grab',
                      userSelect: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                    }}
                    className="op-board-node"
                  >
                    {pinToggle}
                    {collapseToggle}
                    {/* A square marker (vs. problem nodes' round dot below) -
                        same shape-based distinction as the squared corners. */}
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: node.color, flexShrink: 0 }} />
                    {isRenaming ? (
                      <input
                        autoFocus
                        // Pre-selects the whole value on focus - handy right
                        // after creating a card, where the field starts out
                        // filled with the "New pattern" placeholder title
                        // and the user just wants to type over it.
                        onFocus={(e) => e.target.select()}
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
                          fontSize: displayedFontPx,
                          fontWeight: 700,
                          background: 'transparent',
                          border: 'none',
                          borderBottom: '1px solid rgba(255,255,255,.3)',
                          color: '#eef0f6',
                          outline: 'none',
                          width: 150,
                        }}
                      />
                    ) : (
                      <span style={{ fontSize: displayedFontPx, fontWeight: 700, color: '#eef0f6', whiteSpace: 'nowrap' }}>
                        {node.title}
                      </span>
                    )}
                    {count > 0 && (
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: '#0a0c16',
                          background: node.color,
                          borderRadius: 999,
                          padding: '2px 8px',
                        }}
                      >
                        {count}
                      </span>
                    )}
                    {/* Only shown while renaming (text edit active) - not a
                        permanent part of the box. Positioned in the box's
                        top-right corner rather than inline with the title,
                        so it reads as "cancel/discard this card" rather than
                        a generic always-there delete affordance. */}
                    {isRenaming && (
                      <button
                        // preventDefault (not just stopPropagation) is the
                        // key part: a mousedown on this button would
                        // otherwise blur the still-focused rename <input>
                        // as the browser's own default behavior BEFORE our
                        // click handler ever runs. That blur fires
                        // commitRename (see the input's onBlur below), which
                        // resets renamingCardId to null - unmounting this
                        // very button (isRenaming turns false) before its
                        // click could fire, so delete silently did nothing.
                        // preventDefault stops the focus change/blur from
                        // happening at all, keeping this button mounted
                        // through the click.
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onClick={() => onDeleteCard(node.refId)}
                        className="op-board-node-delete"
                        title="Delete pattern"
                        style={{
                          position: 'absolute',
                          top: -9,
                          right: -9,
                          width: 20,
                          height: 20,
                          borderRadius: 999,
                          border: '1px solid rgba(248,113,113,.5)',
                          background: '#1a1024',
                          color: '#fca5a5',
                          fontSize: 13,
                          lineHeight: '1',
                          cursor: 'pointer',
                        }}
                      >
                        ×
                      </button>
                    )}
                    {/* Font size controls - independent of box-size resizing
                        below. Admin-only, shown on hover (or mid-drag of the
                        box resize, so it doesn't flicker away while you're
                        dragging the corner). */}
                    {isAdmin && !isRenaming && (hoveredCardKey === node.key || isResizingThis) && (
                      <div
                        onMouseDown={(e) => e.stopPropagation()}
                        style={{
                          position: 'absolute',
                          top: -9,
                          left: -9,
                          display: 'flex',
                          gap: 2,
                        }}
                      >
                        <button
                          onClick={() => adjustFontLevel(node, -1)}
                          title="Decrease text size"
                          style={fontLevelBtnStyle}
                        >
                          A−
                        </button>
                        <button
                          onClick={() => adjustFontLevel(node, 1)}
                          title="Increase text size"
                          style={fontLevelBtnStyle}
                        >
                          A+
                        </button>
                      </div>
                    )}
                    {/* Resize handle - hover the card's bottom-right corner
                        (or drag mid-resize) to reveal a diagonal grab
                        square; drag it to grow/shrink the box's overall
                        size (both width and height together), not just its
                        width. Only shown outside rename mode so it doesn't
                        compete with the rename input's own edge-adjacent
                        delete button. Admin-only, like every other board
                        write affordance. */}
                    {isAdmin && !isRenaming && (hoveredCardKey === node.key || isResizingThis) && (
                      <div
                        onMouseDown={(e) => handleResizeMouseDown(e, node)}
                        title="Drag to resize"
                        style={{
                          position: 'absolute',
                          bottom: -4,
                          right: -4,
                          width: 14,
                          height: 14,
                          borderRadius: '3px 0 3px 0',
                          background: isResizingThis ? '#c4b5fd' : 'rgba(255,255,255,.35)',
                          cursor: 'nwse-resize',
                        }}
                      />
                    )}
                    {/* Live "Level N" readout while actively dragging the
                        resize handle - the whole point of the level system
                        is that it's a nameable number, not a raw pixel size,
                        so surface that number the moment it changes. */}
                    {isResizingThis && (
                      <div
                        style={{
                          position: 'absolute',
                          bottom: -26,
                          right: -4,
                          padding: '2px 7px',
                          borderRadius: 6,
                          background: '#c4b5fd',
                          color: '#181a26',
                          fontSize: 11,
                          fontWeight: 700,
                          whiteSpace: 'nowrap',
                          pointerEvents: 'none',
                        }}
                      >
                        Level {displayedSizeLevel}
                      </div>
                    )}
                  </div>
                );
              }

              // Problem leaf node - a light-filled pill (readable text on a
              // near-white background, vs. the card/pattern node's dark box
              // above) with a round dot marker, contrasting with the card's
              // squared corners + square marker so the two kinds are still
              // distinguishable by shape alone, not just color. Border is
              // now the same weight/style as card nodes (solid, 2px) - only
              // its color carries state (armed/collapsed/difficulty).
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
                    background: node.solved ? '#d7f9ec' : '#eceefb',
                    border: `${isCollapsed && !isArmed ? 3 : 2}px solid ${isArmed ? armedColor : isCollapsed ? '#fde047' : node.color}`,
                    boxShadow: isArmed
                      ? `0 0 0 3px ${armedGlow}`
                      : isCollapsed
                        ? '0 0 0 4px rgba(253,224,71,.55), 0 0 18px rgba(253,224,71,.55)'
                        : '0 3px 10px rgba(0,0,0,.3)',
                    cursor: connectMode || disconnectMode ? 'crosshair' : 'pointer',
                    userSelect: 'none',
                    whiteSpace: 'nowrap',
                  }}
                  className="op-board-node"
                >
                  {pinToggle}
                  {collapseToggle}
                  <span style={{ width: 7, height: 7, borderRadius: 999, background: node.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: '#181a26' }}>
                    {node.solved ? '✓ ' : ''}
                    {node.title}
                  </span>
                  {isAdmin && (
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
                        // Darkened from the old #6b7392 (tuned for a dark node
                        // background) so it stays readable against the new
                        // light fill.
                        color: '#585c78',
                        fontSize: 11,
                        lineHeight: '1',
                        cursor: 'pointer',
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}

            {/* The selected connection's delete button - deliberately a plain
                HTML element rendered AFTER (not inside) the SVG connector
                layer above and AFTER the node map, so it always paints on
                top. It used to live inside the SVG as a <foreignObject> at
                the edge's midpoint; when two connected nodes were dragged
                close together, that midpoint could land ON TOP OF a node,
                and since nodes render later in the DOM (later sibling =
                higher paint order) they'd silently capture the click meant
                for this button - so trying to delete a short edge sometimes
                deleted the node sitting at its midpoint instead. */}
            {selectedConnectionId != null &&
              (() => {
                const conn = connections.find((c) => c.id === selectedConnectionId);
                if (!conn) return null;
                const aKey = nodeKeyOf(conn.nodeAType, conn.nodeAId);
                const bKey = nodeKeyOf(conn.nodeBType, conn.nodeBId);
                // The edge itself is already hidden when either end is
                // collapsed away (see the connections.map above) - don't
                // leave its delete button floating with no visible line.
                if (hiddenKeys.has(aKey) || hiddenKeys.has(bKey)) return null;
                const a = nodeByKey.get(aKey);
                const b = nodeByKey.get(bKey);
                if (!a || !b) return null;
                const pa = resolvedPosition(a);
                const pb = resolvedPosition(b);
                const midX = (pa.x + pb.x) / 2;
                const midY = (pa.y + pb.y) / 2;
                return (
                  <button
                    onClick={() => {
                      onDeleteConnection(conn.id);
                      setSelectedConnectionId(null);
                    }}
                    style={{
                      position: 'absolute',
                      left: midX,
                      top: midY,
                      transform: 'translate(-50%, -50%)',
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
                );
              })()}
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

const fontLevelBtnStyle: CSSProperties = {
  fontFamily: 'inherit',
  fontSize: 10,
  fontWeight: 700,
  width: 18,
  height: 18,
  borderRadius: 999,
  border: '1px solid rgba(255,255,255,.25)',
  background: '#1a1024',
  color: '#eef0f6',
  lineHeight: '1',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
