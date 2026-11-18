import { describe, expect, test } from 'bun:test';
import { payloadFor } from './openrouter';
import type { ChatMessage } from '@/lib/db/types';

const CLAUDE = 'anthropic/claude-sonnet-5';
const convo: ChatMessage[] = [
  { role: 'user', content: 'How was my week?' },
  { role: 'assistant', content: 'Solid.' },
  { role: 'user', content: '<coach_context>…</coach_context>\n\nAnd tomorrow?' },
];

type Block = { type: string; text: string; cache_control?: unknown };
type Msg = { role: string; content: string | Block[] };

describe('payloadFor', () => {
  test('cacheConversation puts a breakpoint on the last message before the final user turn', () => {
    const out = payloadFor(convo, CLAUDE, 'PERSONA', true) as Msg[];
    expect(out).toHaveLength(4);
    expect(out[0].role).toBe('system');
    expect((out[0].content as Block[])[0]).toEqual({ type: 'text', text: 'PERSONA', cache_control: { type: 'ephemeral' } });
    expect(out[1]).toEqual(convo[0]);
    expect(out[2]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'Solid.', cache_control: { type: 'ephemeral' } }] });
    expect(out[3]).toEqual(convo[2]);
  });

  test('the first turn has nothing to cache beyond the persona', () => {
    const out = payloadFor([convo[2]], CLAUDE, 'PERSONA', true) as Msg[];
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual(convo[2]);
  });

  test('without the flag, or for a non-Anthropic model, the history is sent unchanged', () => {
    const off = payloadFor(convo, CLAUDE, 'PERSONA', false) as Msg[];
    expect(off.slice(1)).toEqual(convo);
    const grok = payloadFor(convo, 'x-ai/grok-4.7', 'PERSONA', true) as Msg[];
    expect(grok[0]).toEqual({ role: 'system', content: 'PERSONA' });
    expect(grok.slice(1)).toEqual(convo);
  });

  test('the caller\'s messages are not mutated', () => {
    const copy = JSON.parse(JSON.stringify(convo));
    payloadFor(convo, CLAUDE, 'PERSONA', true);
    expect(convo).toEqual(copy);
  });
});
