import { describe, expect, test } from 'bun:test';
import { sortChatMessages, turnTimestamps } from './chat-order';

describe('turnTimestamps', () => {
  test('the reply is strictly after the question', () => {
    const { user, assistant } = turnTimestamps(Date.parse('2026-11-12T15:53:34.567Z'));
    expect(Date.parse(assistant)).toBeGreaterThan(Date.parse(user));
  });
});

describe('sortChatMessages', () => {
  test('a tied turn puts the question before the reply (the rows saved before the fix)', () => {
    const t1 = '2026-11-12T15:53:34.567704+00:00';
    const t2 = '2026-11-12T15:54:52.909914+00:00';
    const sorted = sortChatMessages([
      { id: 'a2', role: 'assistant', created_at: t2 },
      { id: 'a1', role: 'assistant', created_at: t1 },
      { id: 'u2', role: 'user', created_at: t2 },
      { id: 'u1', role: 'user', created_at: t1 },
    ]);
    expect(sorted.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
  });

  test('distinct timestamps keep time order whatever the role', () => {
    const sorted = sortChatMessages([
      { id: 'u', role: 'user', created_at: '2026-11-12T10:00:00.002Z' },
      { id: 'a', role: 'assistant', created_at: '2026-11-12T10:00:00.001Z' },
    ]);
    expect(sorted.map((m) => m.id)).toEqual(['a', 'u']);
  });
});
