// Talks to problem-service's /board/cards/** endpoints via api-gateway (see
// problem-service's BoardCardController). A board card is a free-standing,
// personal pattern/category node on the Practice page's 2D "Board" view
// (e.g. "Two Pointers") - has no backing problem, just a title and an
// optional color for its connector lines. Independent of api/cards.ts (the
// 3D graph view's equivalent) - the two views never share nodes.

import { apiFetch } from './client';

export interface BoardCard {
  id: number;
  title: string;
  color?: string | null;
  // Manual override for the card's box size / title font size, as a 1-10
  // level (see ProblemBoard2D's SIZE_LEVELS/FONT_LEVELS) rather than raw
  // pixels - null/undefined means "use the default level".
  sizeLevel?: number | null;
  fontLevel?: number | null;
}

export function listBoardCards(accessToken: string): Promise<BoardCard[]> {
  return apiFetch<BoardCard[]>('/board/cards', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function createBoardCard(accessToken: string, title: string, color?: string): Promise<BoardCard> {
  return apiFetch<BoardCard>('/board/cards', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ title, color }),
  });
}

export function updateBoardCard(
  accessToken: string,
  id: number,
  title: string,
  color?: string,
): Promise<BoardCard> {
  return apiFetch<BoardCard>(`/board/cards/${id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ title, color }),
  });
}

// Deliberately separate from updateBoardCard (title/color) - see
// problem-service's BoardCardSizeRequest for why sharing one request shape
// would risk a plain rename call wiping out a saved level. Always takes both
// levels together (not a partial update) - callers that only mean to change
// one pass the other's current value through unchanged.
export function resizeBoardCard(
  accessToken: string,
  id: number,
  sizeLevel: number,
  fontLevel: number,
): Promise<BoardCard> {
  return apiFetch<BoardCard>(`/board/cards/${id}/size`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ sizeLevel, fontLevel }),
  });
}

export function deleteBoardCard(accessToken: string, id: number): Promise<void> {
  return apiFetch<void>(`/board/cards/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}
