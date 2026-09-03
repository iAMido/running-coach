/**
 * Elevation — gradient as a training variable.
 *
 * Written for the 2027-07-03 mountain race (21 km, 1300 m gain). The number
 * that matters there is not the distance, which this athlete can already cover,
 * but the gradient: **61.9 m/km**, against a measured history of
 *
 *   n=128 runs carrying elevation, measured 2026-09-03 after the backfill
 *   min 0.0 · p25 7.5 · median 8.8 · p75 10.9 · p90 11.7 · p95 12.0 · max 20.2
 *
 * Note where the mass sits: p95 is 12.0, and his two steepest runs (20.2 and
 * 13.3) are both from a New York trip. His steepest run in Israel is 12.7. The
 * terrain he can reach from home is essentially one band wide.
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
 *   Flat     < 5     — 19 of his 128 runs. Below his p25 (7.5).
 *   Rolling  5-15    — 107 runs. His median (8.8), p90 (11.7) and p95 (12.0)
 *                      all sit here, as does every run he has done in Israel.
 *                      This is simply what his normal running is.
 *   Hilly    15-25   — 1 run (20.2, in New York). Genuinely rare for him.
 *   Mountain >= 25   — 0 runs. NOTHING in his history reaches this band.
 *
 * ## Why the Hilly floor is 15 and not 12
 *
 * 12 was the first choice and it was wrong, in a way only measuring after the
 * backfill revealed: **his p95 is exactly 12.0**, so a floor of 12 landed on
 * top of a dense cluster. Seven runs cleared it, and five of them were
 * ordinary 5-8 km easy and recovery runs sitting at 12.0-12.7 — a one-metre
 * difference in recorded climb flipped them between "easy run" and "hill
 * session". A band boundary inside the bulk of a distribution does not
 * classify, it coin-flips.
 *
 * 15 sits clear above everything he can reach from home (his Israeli maximum
 * is 12.7) and below the gradients mountain training will actually produce —
 * the local trail loops in docs/mountain-race-plan.md run 26-47 m/km.
 *
 * `Mountain` having no historical member is the point, not an oversight: race
 * day is 61.9 m/km and the gap between "his hardest ever" and "the race" is the
 * whole training problem. Anything rendering these labels must not imply he has
 * been there — see `climbCategoryIsUnprecedented`.
 */
export const CLIMB_BANDS: { category: ClimbCategory; minVertPerKm: number }[] = [
  { category: 'Mountain', minVertPerKm: 25 },
  { category: 'Hilly', minVertPerKm: 15 },
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
 * Tracks the `Hilly` floor, and flags exactly 1 of his 128 recorded runs. That
 * rarity is the calibration: on the terrain he can currently reach this fires
 * almost never, and once mountain-specific work starts it should fire often. A
 * threshold matching a third of his history would be measuring his
 * neighbourhood rather than his training.
 *
 * Sits deliberately clear of the 12.0-12.7 cluster at his p95 — see the note
 * on CLIMB_BANDS for what happens to a boundary placed inside the bulk.
 */
export const VERT_SESSION_MIN_M_PER_KM = 15;

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

/**
 * Average gradient as a PERCENT grade.
 *
 * The same number as m/km divided by ten, and worth carrying separately
 * because percent is the unit the athlete can act on: it is what a treadmill
 * console shows, what a trail sign shows, and what makes "6%" immediately
 * comparable to "set the treadmill to 12%". m/km is the better unit for
 * comparing runs to each other; percent is the better unit for prescribing.
 */
export function gradePercent(gainM: number | null | undefined, distanceKm: number | null | undefined): number | null {
  const vpk = vertPerKm(gainM, distanceKm);
  return vpk === null ? null : vpk / 10;
}

/**
 * Vertical metres per hour on a treadmill at a given grade and speed.
 *
 * At grade G%, every 100 m of belt travel climbs G metres — so a km climbs
 * 10·G metres, and an hour at S km/h climbs 10·G·S.
 *
 * This exists because the athlete's home terrain cannot produce the race's
 * vertical load: the local hills top out around 12.7 m/km against a 61.9 m/km
 * race, so the climbing has to be accumulated indoors. A plan that says "600 m
 * of vert this week" without saying what that IS on a treadmill is a plan he
 * cannot execute on the equipment he actually has.
 */
export function treadmillVertPerHour(gradePercent: number, speedKmh: number): number {
  if (!Number.isFinite(gradePercent) || !Number.isFinite(speedKmh)) return 0;
  if (gradePercent <= 0 || speedKmh <= 0) return 0;
  return 10 * gradePercent * speedKmh;
}

/**
 * A small table of realistic treadmill settings and what they yield per hour,
 * for a prompt to prescribe against.
 *
 * Speeds are power-hiking to slow-jog pace, because that is what these grades
 * actually permit: at 12-15% a run stride pushes heart rate past threshold
 * within minutes, which is the whole reason hiking is the correct technique
 * rather than a concession.
 */
export const TREADMILL_VERT_TABLE: { gradePercent: number; speedKmh: number; vertPerHour: number }[] =
  [
    { gradePercent: 8, speedKmh: 6.0 },
    { gradePercent: 10, speedKmh: 5.5 },
    { gradePercent: 12, speedKmh: 5.0 },
    { gradePercent: 15, speedKmh: 4.5 },
  ].map((r) => ({ ...r, vertPerHour: Math.round(treadmillVertPerHour(r.gradePercent, r.speedKmh)) }));

/**
 * Names that mean "this session happened indoors".
 *
 * Load-bearing for elevation: most treadmills do not transmit incline to the
 * watch, so an indoor session that climbed 700 m is commonly recorded as 0 m.
 * Storing that 0 would make a hard vertical week read as a flat one — the
 * scorecard would score it red and the weekly loop would fire
 * `vert_below_phase` on a week the athlete executed perfectly.
 */
const INDOOR_NAME = /treadmill|indoor|הליכון|stair ?master|stairmaster|gym/i;

export function looksIndoor(workoutName: string | null | undefined, activityType?: string | null): boolean {
  if (activityType === 'VirtualRun') return true;
  return !!workoutName && INDOOR_NAME.test(workoutName);
}

/**
 * Elevation for an indoor run: 0 becomes **null**, i.e. unmeasured.
 *
 * Outdoors, 0 m of gain is a real measurement — a flat run. Indoors it almost
 * always means the treadmill never told the watch its incline, and this app's
 * standing rule is that an unmeasured value must never be stored as a measured
 * zero. A genuine positive reading is kept: some treadmills do report incline,
 * and that number is real.
 */
export function indoorAwareGain(
  gainM: number | null | undefined,
  workoutName: string | null | undefined,
  activityType?: string | null,
): number | null {
  if (typeof gainM !== 'number') return null;
  if (gainM === 0 && looksIndoor(workoutName, activityType)) return null;
  return gainM;
}
