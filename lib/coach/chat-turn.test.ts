import { describe, expect, test } from 'bun:test';
import { withTurnContext } from './chat-turn';

describe('withTurnContext', () => {
  const history = [
    { role: 'user' as const, content: 'How was my week?' },
    { role: 'assistant' as const, content: 'Solid.' },
    { role: 'user' as const, content: 'And tomorrow?' },
  ];

  test('the context goes into the last user turn; earlier turns are untouched', () => {
    const out = withTurnContext(history, 'ATHLETE DATA');
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual(history[0]);
    expect(out[1]).toEqual(history[1]);
    expect(out[2].role).toBe('user');
    expect(out[2].content).toContain('<coach_context>');
    expect(out[2].content).toContain('ATHLETE DATA');
    expect(out[2].content.endsWith('And tomorrow?')).toBe(true);
  });

  test('no system message is left in front of the history (it would break the cached prefix)', () => {
    const out = withTurnContext([{ role: 'system', content: 'sneaky' }, ...history], 'CTX');
    expect(out.some((m) => m.role === 'system')).toBe(false);
  });

  test('the history before the new turn is byte-identical from one turn to the next', () => {
    const turn1 = withTurnContext(history, 'CTX 1');
    const turn2 = withTurnContext([...history, { role: 'assistant', content: 'Easy 6 km.' }, { role: 'user', content: 'Thanks' }], 'CTX 2');
    // What turn 2 can read from cache is everything up to the last reply, which
    // must not carry turn 1's context — it is the raw message.
    expect(turn2.slice(0, 2)).toEqual(turn1.slice(0, 2));
    expect(turn2[2]).toEqual(history[2]);
  });

  test('with no user message, falls back to a system message', () => {
    const out = withTurnContext([], 'CTX');
    expect(out).toEqual([{ role: 'system', content: 'CTX' }]);
  });
});
