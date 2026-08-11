// Talks to problem-service's /board/connections/** endpoints via
// api-gateway (see problem-service's BoardConnectionController). Each row
// is a personal, per-user edge between two board nodes drawn on the
// Practice page's 2D "Board" view - independent of api/connections.ts (the
// 3D graph view's equivalent). An endpoint can be a problem or a
// BoardCard (see api/boardCards.ts).

import { apiFetch } from './client';

export type BoardNodeType = 'PROBLEM' | 'CARD';

export interface BoardNodeRef {
  type: BoardNodeType;
  id: number;
}

export interface BoardConnection {
  id: number;
  nodeAType: BoardNodeType;
  nodeAId: number;
  nodeBType: BoardNodeType;
  nodeBId: number;
  color?: string | null;
}

export function listBoardConnections(accessToken: string): Promise<BoardConnection[]> {
  return apiFetch<BoardConnection[]>('/board/connections', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// The backend canonicalizes (by type, then id) so the order passed here
// doesn't matter, and re-creating an existing pair is idempotent.
export function createBoardConnection(
  accessToken: string,
  a: BoardNodeRef,
  b: BoardNodeRef,
  color?: string,
): Promise<BoardConnection> {
  return apiFetch<BoardConnection>('/board/connections', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ nodeAType: a.type, nodeAId: a.id, nodeBType: b.type, nodeBId: b.id, color }),
  });
}

export function deleteBoardConnection(accessToken: string, id: number): Promise<void> {
  return apiFetch<void>(`/board/connections/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}
