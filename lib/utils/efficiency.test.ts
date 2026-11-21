import { describe, expect, test } from 'bun:test';
import { buildEfficiencySummary, formatEfficiency, MIN_EF_SAMPLES, type EfRun } from './efficiency';

const steady = (date: string, gap = 7.3, hr = 140): EfRun => ({
  date, runType: 'Easy', durationMin: 45, avgHr: hr, gapPaceMinKm: gap, vertPerKm: 9,
});

describe('formatEfficiency when the current window is thin', () => {
  // Shape of the 2026-11-21 window: 4 steady runs, the rest short or intervals,
  // while the window ending three weeks earlier still had enough.
  const runs: EfRun[] = [
    ...['2026-09-20', '2026-09-21', '2026-09-23', '2026-09-25', '2026-09-28', '2026-09-30', '2026-10-03'].map((d) => steady(d)),
    steady('2026-10-19'), steady('2026-10-27'), steady('2026-11-13'), steady('2026-11-20'),
    { ...steady('2026-11-12'), durationMin: 22.7 },
    { ...steady('2026-11-19'), durationMin: 22.5 },
    { ...steady('2026-11-16'), runType: 'Intervals' },
    { ...steady('2026-11-14'), gapPaceMinKm: null },
  ];

  test('says why instead of returning nothing', () => {
    const summary = buildEfficiencySummary(runs, '2026-11-21');
    expect(summary.current).toBeNull();
    expect(summary.currentCounts).toMatchObject({ eligible: 4, short: 2, structured: 1, noGap: 1, other: 0 });

    const text = formatEfficiency(summary);
    expect(text).toContain('Not measurable now: 4 steady runs');
    expect(text).toContain(`at least ${MIN_EF_SAMPLES}`);
    expect(text).toContain('2 under 30 min');
    expect(text).toContain('1 interval/fartlek');
    expect(text).toContain('Last measurable window');
    expect(text).toContain('history, not the current value');
  });

  test('stays silent when the window holds no runs at all', () => {
    expect(formatEfficiency(buildEfficiencySummary([], '2026-11-21'))).toBe('');
  });

  test('a measurable window is unchanged', () => {
    const many = Array.from({ length: 10 }, (_, i) => steady(`2026-11-${String(i + 10).padStart(2, '0')}`));
    const text = formatEfficiency(buildEfficiencySummary(many, '2026-11-21'));
    expect(text).toContain('- Now: ');
    expect(text).not.toContain('Not measurable');
  });
});
