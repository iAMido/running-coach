/**
 * Chat message ordering.
 *
 * A turn's user and assistant rows were written in one insert, so both got
 * the same `created_at` (Postgres now() is per transaction) and
 * `order by created_at` returned them in arbitrary order: measured on
 * 2026-11-18, 3 of the 4 turns since Nov 9 came back reply-first. A reloaded
 * chat showed answers above their questions, and that history was sent back
 * to the model in the wrong order.
 *
 * New rows get explicit timestamps 1 ms apart; old rows are fixed on read by
 * putting the user message first within a tie.
 */

export function turnTimestamps(now: number = Date.now()): { user: string; assistant: string } {
  return { user: new Date(now).toISOString(), assistant: new Date(now + 1).toISOString() };
}

const ROLE_RANK: Record<string, number> = { system: 0, user: 1, assistant: 2 };

export function sortChatMessages<T extends { created_at: string; role: string }>(messages: T[]): T[] {
  return [...messages].sort((a, b) => {
    const t = Date.parse(a.created_at) - Date.parse(b.created_at);
    if (t !== 0) return t;
    return (ROLE_RANK[a.role] ?? 3) - (ROLE_RANK[b.role] ?? 3);
  });
}
