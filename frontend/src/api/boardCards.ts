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

export function deleteBoardCard(accessToken: string, id: number): Promise<void> {
  return apiFetch<void>(`/board/cards/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}
