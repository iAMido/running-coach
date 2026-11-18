import { describe, expect, test } from 'bun:test';
import { checkSpend, dailyCapUsd, DEFAULT_DAILY_CAP_USD, overCapMessage, recordSpend, type SpendBackend } from './spend';

function memoryBackend(initial = 0, fail = false) {
  const ledger = new Map<string, number>();
  if (initial) ledger.set('u1|2026-11-18', initial);
  const adds: number[] = [];
  const backend: SpendBackend = {
    async spent(userId, day) {
      if (fail) return null;
      return ledger.get(`${userId}|${day}`) ?? 0;
    },
    async add(userId, day, usd) {
      if (fail) throw new Error('db down');
      adds.push(usd);
      ledger.set(`${userId}|${day}`, (ledger.get(`${userId}|${day}`) ?? 0) + usd);
    },
  };
  return { backend, adds, ledger };
}

const day = '2026-11-18';

describe('daily AI spend cap', () => {
  test('under the cap is allowed; at or over it is refused', async () => {
    expect(await checkSpend('u1', { backend: memoryBackend(24.99).backend, cap: 25, day })).toEqual({ allowed: true });
    expect(await checkSpend('u1', { backend: memoryBackend(25).backend, cap: 25, day })).toEqual({ allowed: false, spent: 25, cap: 25 });
  });

  test('recorded spend accumulates and then trips the cap', async () => {
    const { backend } = memoryBackend();
    await recordSpend('u1', 3.1, { backend, day });
    await recordSpend('u1', 2, { backend, day });
    expect((await checkSpend('u1', { backend, cap: 5, day })).allowed).toBe(false);
    expect((await checkSpend('u2', { backend, cap: 5, day })).allowed).toBe(true);
  });

  test('a call with unknown cost is counted as a call at $0, never a negative', async () => {
    const { backend, adds } = memoryBackend();
    await recordSpend('u1', null, { backend, day });
    await recordSpend('u1', -1, { backend, day });
    expect(adds).toEqual([0, 0]);
  });

  test('an unreadable ledger fails open, and a failed write does not throw', async () => {
    const { backend } = memoryBackend(999, true);
    expect(await checkSpend('u1', { backend, cap: 25, day })).toEqual({ allowed: true });
    await recordSpend('u1', 1, { backend, day }); // must not throw
  });

  test('cap comes from AI_DAILY_CAP_USD when it is a positive number', () => {
    expect(dailyCapUsd('40')).toBe(40);
    expect(dailyCapUsd(undefined)).toBe(DEFAULT_DAILY_CAP_USD);
    expect(dailyCapUsd('nonsense')).toBe(DEFAULT_DAILY_CAP_USD);
    expect(dailyCapUsd('0')).toBe(DEFAULT_DAILY_CAP_USD);
  });

  test('the refusal says how much and when it resets', () => {
    expect(overCapMessage({ spent: 25.3, cap: 25 })).toContain('$25.30 of $25.00');
    expect(overCapMessage({ spent: 25.3, cap: 25 })).toContain('midnight Israel time');
  });
});
