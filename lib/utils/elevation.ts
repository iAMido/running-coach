/**
 * Elevation — gradient as a training variable.
 *
 * Written for the 2027-07-03 mountain race (21 km, 1300 m gain). The number
 * that matters there is not the distance, which this athlete can already cover,
 * but the gradient: **61.9 m/km**, against a measured history of
 *
 *   n=128 runs carrying elevation, probed live 2026-09-03
 *   min 0.0 · p25 7.5 · median 8.8 · p75 10.8 · p90 11.6 · max 20.2 m/km
 *
 * Race day is ~3x his steepest single run ever and ~7x his typical one.
 *
 * ## Why the bands below are his and not Strava's
 *
 * Every threshold here is a quantile of that distribution rather than a
 * convention borrowed from another athlete or another sport. This project has
 * been bitten twice by imported bands — Friel's decoupling cutoffs would have
 * labelled a third of his easy running "too hard", and the legacy zone data
 * asserted Z6 time on runs whose max HR never reached the Z6 floor. The rule
 * that came out of both: a threshold you did not measure on this athlete is a
 * guess wearing a number's clothes.
 *
 * ## What this file deliberately does NOT do
 *
 * **No grade-adjusted pace.** `runs.gap_pace_min_km` already holds GAP,
 * supplied by intervals.icu and converted once at ingest. A second
 * grade-adjustment computed here would be a second, non-comparable measurement
 * in the same conceptual slot — exactly the failure mode CLAUDE.md records for
 * decoupling. If GAP quality is ever in doubt, check it against intervals.icu's
 * own figure; do not recompute it.
 *
 * **No vertical TRIMP.** Weighting climb by intensity needs a climb RATE, and
 * VAM (`average_vertical_speed`) is present on only 9 of 130 activities. A load
 * metric backed by 7% coverage is worse than none.
 */

/**
 * Metres of climb per kilometre — the gradient measure this build turns on.
 *
 * Returns null rather than 0 when either input is missing or the distance is
 * zero. A run with no elevation reading is not a flat run, and 560 rows in this
 * database exist precisely because someone once stored "unmeasured" as a
 * number.
 */
export function vertPerKm(
  gainM: number | null | undefined,
  distanceKm: number | null | undefined,
): number | null {
  if (typeof gainM !== 'number' || !Number.isFinite(gainM)) return null;
  if (typeof distanceKm !== 'number' || !Number.isFinite(distanceKm) || distanceKm <= 0) return null;
  return gainM / distanceKm;
}

export type ClimbCategory = 'Flat' | 'Rolling' | 'Hilly' | 'Mountain';

/**
 * Lower bound of each band, m/km, keyed to the athlete's own distribution.
 *
 *   Flat     < 5     — 18 of his 128 runs. Below his p25 (7.5).
 *   Rolling  5-12    — 109 runs. His median (8.8) and p90 (11.6) both sit here;
 *                      this is simply what his normal running is.
 *   Hilly    12-25   — 1 run (20.2, his steepest ever). Genuinely rare for him.
 *   Mountain >= 25   — 0 runs. NOTHING in his history reaches this band.
 *
 * `Mountain` having no historical member is the point, not an oversight: race
 * day is 61.9 m/km and the gap between "his hardest ever" and "the race" is the
 * whole training problem. Anything rendering these labels must not imply he has
 * been there — see `climbCategoryIsUnprecedented`.
 */
export const CLIMB_BANDS: { category: ClimbCategory; minVertPerKm: number }[] = [
  { category: 'Mountain', minVertPerKm: 25 },
  { category: 'Hilly', minVertPerKm: 12 },
  { category: 'Rolling', minVertPerKm: 5 },
  { category: 'Flat', minVertPerKm: 0 },
];

/** The band a gradient falls in, or null when there is no elevation reading. */
export function climbCategory(vertPerKmValue: number | null | undefined): ClimbCategory | null {
  if (typeof vertPerKmValue !== 'number' || !Number.isFinite(vertPerKmValue)) return null;
  return CLIMB_BANDS.find((b) => vertPerKmValue >= b.minVertPerKm)?.category ?? 'Flat';
}

/**
 * True for a band this athlete has never actually run.
 *
 * Exists so a UI badge or a prompt line can say "no comparable session in your
 * history" instead of presenting `Mountain` as a routine category alongside
 * `Rolling`, which would read as though he has done this before.
 */
export function climbCategoryIsUnprecedented(category: ClimbCategory | null): boolean {
  return category === 'Mountain';
}

/**
 * The gradient at which a run is a climbing session rather than a run that
 * happened to go uphill.
 *
 * 12 m/km is his `Hilly` floor, and it flags exactly 1 of his 128 recorded
 * runs. That rarity is the calibration: on his current terrain this fires
 * almost never, and once mountain-specific work starts it should fire often.
 * A threshold that already matched a third of his history would measure his
 * neighbourhood, not his training.
 */
export const VERT_SESSION_MIN_M_PER_KM = 12;

/**
 * Distance at which a high-vert session reads as a long run rather than a
 * short, steep one. Deliberately below the 15 km the road classifier uses:
 * 12 km at race gradient is over two hours on feet, which is a long run by
 * every measure except the odometer.
 */
export const TRAIL_LONG_RUN_MIN_KM = 12;

/** The race this build exists for. */
export const TARGET_RACE = {
  date: '2027-07-03',
  distanceKm: 21,
  gainM: 1300,
  /** 61.9 m/km. */
  get vertPerKm() {
    return this.gainM / this.distanceKm;
  },
} as const;

/**
 * Where a run's gradient sits against race day, as a multiple.
 *
 * Rendered rather than a raw difference because the honest framing of this
 * athlete's position is "you have run a third of race gradient once", and a
 * ratio says that in one number.
 */
export function fractionOfRaceGradient(vertPerKmValue: number | null | undefined): number | null {
  if (typeof vertPerKmValue !== 'number' || !Number.isFinite(vertPerKmValue)) return null;
  return vertPerKmValue / TARGET_RACE.vertPerKm;
}

/**
 * One compact tag for a run line, e.g. `[+340m, 34 m/km — Mountain]`.
 *
 * Returns `[vert n/a]` when there is no reading, never an empty string and
 * never a zero. An absent elevation reading and a genuinely flat run are
 * different facts and must not render identically — the same rule GAP follows
 * two lines above it in the same output.
 */
export function formatVert(
  gainM: number | null | undefined,
  distanceKm: number | null | undefined,
  lossM?: number | null,
): string {
  if (typeof gainM !== 'number' || !Number.isFinite(gainM)) return '[vert n/a]';

  const parts = [`+${Math.round(gainM)}m`];
  if (typeof lossM === 'number' && Number.isFinite(lossM)) parts.push(`-${Math.round(lossM)}m`);

  const vpk = vertPerKm(gainM, distanceKm);
  if (vpk === null) return `[${parts.join(' / ')}]`;

  const category = climbCategory(vpk);
  return `[${parts.join(' / ')}, ${vpk.toFixed(1)} m/km — ${category}]`;
}

/** Total climb across a set of runs, and how many of them carried a reading. */
export function sumVert(runs: { elevation_gain_m?: number | null }[]): {
  totalM: number;
  measured: number;
  total: number;
} {
  const measured = runs.filter((r) => typeof r.elevation_gain_m === 'number');
  return {
    totalM: measured.reduce((sum, r) => sum + (r.elevation_gain_m as number), 0),
    measured: measured.length,
    total: runs.length,
  };
}
