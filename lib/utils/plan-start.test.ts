import { expect, test } from 'bun:test';
import { planStartDate } from './plan-start';

test('start_date, else created day, else today', () => {
  expect(planStartDate({ start_date: '2026-11-08', created_at: '2026-11-01T10:00:00Z' }, '2026-11-18')).toBe('2026-11-08');
  expect(planStartDate({ start_date: null, created_at: '2026-11-01T10:00:00Z' }, '2026-11-18')).toBe('2026-11-01');
  expect(planStartDate({}, '2026-11-18')).toBe('2026-11-18');
});
