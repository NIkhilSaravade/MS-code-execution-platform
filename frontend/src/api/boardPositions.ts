// Talks to problem-service's /board/positions/** endpoints via api-gateway
// (see problem-service's BoardPositionController). Each row is where the
// current user has manually dragged one board node (a problem or a board
// card) to on the Practice page's 2D "Board" view - personal, 2D-only
// (x/y, no z) since the board is a flat canvas, not the 3D graph view.

import { apiFetch } from './client';
import type { BoardNodeType } from './boardConnections';

export interface BoardNodePosition {
  nodeType: BoardNodeType;
  nodeId: number;
  x: number;
  y: number;
}

export function listBoardPositions(accessToken: string): Promise<BoardNodePosition[]> {
  return apiFetch<BoardNodePosition[]>('/board/positions', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Upsert - re-dragging the same node overwrites its previous saved spot.
export function saveBoardPosition(accessToken: string, position: BoardNodePosition): Promise<BoardNodePosition> {
  return apiFetch<BoardNodePosition>('/board/positions', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(position),
  });
}

// "Remove from board" for a node that isn't itself being deleted (a
// problem, which is global) - just clears its saved spot so it drops back
// out of the canvas into the sidebar's unplaced list.
export function deleteBoardPosition(accessToken: string, nodeType: BoardNodeType, nodeId: number): Promise<void> {
  return apiFetch<void>(`/board/positions/${nodeType}/${nodeId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}
