/** Run with `bun test`. */
import { expect, test } from 'bun:test';
import { buildRunEdit, buildRunRestore, inclineSession } from './treadmill';

const watchRun = {
  distance_km: 6.1, duration_min: 55, duration_sec: 3300, avg_pace_min_km: 9.016, avg_pace_str: '9:01',
  elevation_gain_m: null, elevation_loss_m: null, gap_pace_min_km: 8.2, is_treadmill: false, manual_edit: null,
};

test('incline calculator: grade x speed x time, the same arithmetic the planners use', () => {
  expect(inclineSession(10, 5.5, 20)).toEqual({ distance_km: 1.83, elevation_gain_m: 183 });
  expect(inclineSession(12, 5, 30).elevation_gain_m).toBe(300);
});

test('a treadmill edit writes the entered numbers, recomputes pace, keeps the watch values', () => {
  const p = buildRunEdit(watchRun, { is_treadmill: true, distance_km: 5, duration_min: 55, elevation_gain_m: 480 });
  expect(p.distance_km).toBe(5);
  expect(p.elevation_gain_m).toBe(480);
  expect(p.avg_pace_str).toBe('11:00');
  expect(p.elevation_loss_m).toBe(0); // a belt never descends
  expect(p.gap_pace_min_km).toBeNull(); // watch GAP on a belt is meaningless
  const me = p.manual_edit as { original: { distance_km: number; gap_pace_min_km: number }; fields: string[] };
  expect(me.original.distance_km).toBe(6.1);
  expect(me.fields).toEqual(expect.arrayContaining(['distance_km', 'elevation_gain_m', 'is_treadmill']));
});

test('a second edit keeps the ORIGINAL watch values, so restore always restores the watch', () => {
  const first = { ...watchRun, ...buildRunEdit(watchRun, { is_treadmill: true, elevation_gain_m: 300 }) } as never;
  const second = buildRunEdit(first, { is_treadmill: true, elevation_gain_m: 450 });
  expect((second.manual_edit as { original: { elevation_gain_m: number | null } }).original.elevation_gain_m).toBeNull();
  const restored = buildRunRestore({ ...(first as object), ...second } as never)!;
  expect(restored.distance_km).toBe(6.1);
  expect(restored.elevation_gain_m).toBeNull();
  expect(restored.manual_edit).toBeNull();
});

test('impossible values are refused', () => {
  expect(() => buildRunEdit(watchRun, { is_treadmill: true, distance_km: -1 })).toThrow();
  expect(() => buildRunEdit(watchRun, { is_treadmill: true, elevation_gain_m: 20000 })).toThrow();
});
