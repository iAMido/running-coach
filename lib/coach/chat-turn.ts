import type { ChatMessage } from '@/lib/db/types';

/**
 * Where the per-turn coach context goes in a chat request (2026-11-18).
 *
 * It used to be a system message right after the cached coach persona. It
 * changes every turn (fresh retrieval, today's data), so everything after it
 * — the whole conversation — could never be cached and was paid in full on
 * every turn. Now the request is:
 *
 *   system: COACH_STATIC_BLOCK          ← cache breakpoint 1 (byte-stable)
 *   …history…, last assistant reply     ← cache breakpoint 2 (callOpenRouter cacheConversation)
 *   user: <coach_context>…</coach_context> + the athlete's message
 *
 * so the persona AND the conversation so far are read from cache, and only
 * the new turn is paid in full. Each turn's context lives only in that turn,
 * exactly as before: history is sent as the athlete and coach wrote it.
 *
 * Client-sent `system` messages are dropped: the chat page never sends one,
 * and one in the history would break the cached prefix.
 */
export const TURN_CONTEXT_NOTE =
  'The block below is supplied by the app for this turn (the athlete\'s data, previous-coach patterns, methodology, and any task instructions). ' +
  'The athlete did not write it. The athlete\'s own message follows it.';

export function withTurnContext(messages: ChatMessage[], turnContext: string): ChatMessage[] {
  const conversation = messages.filter((m) => m.role !== 'system');
  const lastUser = conversation.map((m) => m.role).lastIndexOf('user');
  if (lastUser === -1) {
    // Nothing to attach it to: fall back to the old shape.
    return [{ role: 'system', content: turnContext }, ...conversation];
  }
  const turn = conversation[lastUser];
  return [
    ...conversation.slice(0, lastUser),
    {
      role: 'user',
      content: `<coach_context>\n${TURN_CONTEXT_NOTE}\n\n${turnContext}\n</coach_context>\n\n${turn.content}`,
    },
    ...conversation.slice(lastUser + 1),
  ];
}
