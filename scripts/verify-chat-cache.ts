/**
 * Measures what the chat reads from cache on a later turn, in the old request
 * shape (per-turn context as a system message, history uncacheable) and the
 * new one (context inside the final user turn, breakpoint on the history).
 * Sends 4 tiny calls (maxTokens 20) with synthetic history; writes nothing.
 *
 *   bun --env-file=.env.local scripts/verify-chat-cache.ts
 */
import { callOpenRouter } from '@/lib/ai/openrouter';
import { COACH_STATIC_BLOCK } from '@/lib/ai/coach-prompts';
import { MODEL_FOR } from '@/lib/ai/model-registry';
import { withTurnContext } from '@/lib/coach/chat-turn';
import type { ChatMessage } from '@/lib/db/types';

const model = MODEL_FOR.chat_default;
const apiKey = process.env.OPENROUTER_API_KEY;
const nonce = Date.now(); // a fresh cache for every run
const filler = (label: string) =>
  Array.from({ length: 60 }, (_, i) => `${label} ${nonce} line ${i}: easy aerobic running builds the base; keep heart rate in zone 2 and add strides twice a week.`).join('\n');

const history: ChatMessage[] = [
  { role: 'user', content: 'How was my week?' },
  { role: 'assistant', content: filler('reply-1') },
  { role: 'user', content: 'And what about the long run?' },
  { role: 'assistant', content: filler('reply-2') },
];
const ctx = (n: number) => `ATHLETE CONTEXT turn ${n} ${nonce}\n${filler(`ctx-${n}`)}`;

async function call(messages: ChatMessage[], cacheConversation: boolean) {
  const r = await callOpenRouter(messages, {
    apiKey, model, maxTokens: 20, cacheableSystemPrefix: COACH_STATIC_BLOCK, cacheConversation,
  });
  if (r.error) throw new Error(r.error);
  return { prompt: r.promptTokens ?? null, cached: r.cachedTokens ?? null };
}

const oldShape = (msgs: ChatMessage[], n: number): ChatMessage[] => [{ role: 'system', content: ctx(n) }, ...msgs];

// Turn 2 writes the cache, turn 3 is measured.
const turn2 = history.slice(0, 3);
const turn3: ChatMessage[] = [...history, { role: 'user', content: 'Thanks, anything else?' }];

await call(oldShape(turn2, 2), false);
const before = await call(oldShape(turn3, 3), false);
await call(withTurnContext(turn2, ctx(2)), true);
const after = await call(withTurnContext(turn3, ctx(3)), true);

console.log(`model ${model}`);
console.log(`old shape, turn 3: prompt ${before.prompt}, read from cache ${before.cached}`);
console.log(`new shape, turn 3: prompt ${after.prompt}, read from cache ${after.cached}`);
