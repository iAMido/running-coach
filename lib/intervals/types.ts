/**
 * intervals.icu API response shapes.
 *
 * Only the fields the app actually consumes are typed. The API returns a great
 * deal more per activity (running dynamics, polarization index, per-activity
 * CTL/ATL); those are deliberately left untyped until something needs them.
 *
 * Every shape here was verified against the live account on 2026-08-05 — see
 * docs/intervals-icu-probe-findings.md. Do not add speculative fields.
 */

/** An activity summary from `GET /athlete/{id}/activities`. */
export interface IntervalsActivity {
  /** Looks like "i172834288". */
  id: string;
  /** Run, VirtualRun, Ride, Swim, WeightTraining, Hike, Elliptical, Pilates... */
  type: string;
  name: string;
  /**
   * TRUE UTC — "2025-11-02T15:22:43Z". Authoritative; always prefer this.
   *
   * Undocumented in the probe findings (which only recorded
   * `start_date_local`), but present on all 117 activities in the account.
   */
  start_date?: string | null;
  /**
   * LOCAL wall-clock time, no offset — e.g. "2026-08-03T06:12:34".
   *
   * Local to WHERE THE RUN HAPPENED, not to the athlete's home timezone. Only
   * a fallback: converting it assumes Asia/Jerusalem, which is wrong for any
   * run recorded while travelling.
   */
  start_date_local: string;
  /** Metres. */
  distance: number;
  /** Seconds. */
  moving_time: number;
  average_heartrate?: number | null;
  max_heartrate?: number | null;
  calories?: number | null;
  /**
   * Grade-adjusted pace as a SPEED in m/s (not a pace). Populated 18/18 in
   * probing. Converted to min/km at ingest so it can sit beside
   * `avg_pace_min_km` in the same unit.
   */
  gap?: number | null;
  /**
   * ONE-LEG cadence (rpm), not steps per minute — measured 56.2-83.6 across
   * this athlete's runs. Doubled at ingest into `cadence_spm`.
   */
  average_cadence?: number | null;
  /**
   * Metres climbed, already corrected. `use_elevation_correction` is true on
   * every activity in the account, so this is intervals.icu's barometric/DEM
   * figure rather than raw GPS altitude. Populated 128/130 in the 2026-09-03
   * probe over 400 days.
   */
  total_elevation_gain?: number | null;
  /**
   * Metres descended, reported positive. Same 128/130 coverage as gain, and on
   * the same summary payload — descent costs no extra request.
   *
   * Not redundant with gain: a point-to-point route has no reason for the two
   * to match, and eccentric descent loading is a distinct stressor from climb.
   */
  total_elevation_loss?: number | null;
  /**
   * The athlete's max HR as intervals.icu holds it. Present on every activity.
   *
   * Load-bearing for write-back: pushed workouts are percentages that
   * intervals.icu resolves against THIS number, so if it diverges from
   * `athlete_profile.max_hr` every pushed workout silently means something
   * else. Checked on every sync — see `warnIfMaxHrDiverged`.
   */
  athlete_max_hr?: number | null;
  /** Their threshold HR (173). Does NOT feed % HR resolution — max does. */
  lthr?: number | null;
  /** intervals.icu's own precomputed load. The app keeps its own TRIMP as
   *  authoritative; this is stored alongside only as a cross-check. */
  icu_training_load?: number | null;
}

/** One lap from `GET /activity/{id}/intervals` -> `.icu_intervals[]`. */
export interface IntervalsInterval {
  /** Seconds. */
  moving_time: number;
  /** Metres. */
  distance: number;
  average_heartrate?: number | null;
  max_heartrate?: number | null;
  /** Metres per second. */
  average_speed?: number | null;

  /** Grade-adjusted SPEED in m/s, same as on the activity. */
  gap?: number | null;
  /** ONE-LEG cadence (rpm). Doubled at ingest — see IntervalsActivity. */
  average_cadence?: number | null;
  /**
   * Metres climbed IN THIS LAP. Present on 191/191 laps across a 12-run sample.
   *
   * ⚠ Does NOT sum to the activity's `total_elevation_gain` — measured 130.4 m
   * summed across laps against 210.9 m on the activity. intervals.icu laps are
   * auto-detected work/recovery segments that do not tile the whole run, so the
   * shortfall is uncovered time rather than a discrepancy. Never derive a run's
   * elevation from its laps.
   */
  total_elevation_gain?: number | null;

  // Richer than Strava ever provided, still unmapped. `intensity` would sharpen
  // the weekly-review per-rep commentary.
  min_heartrate?: number | null;
  /** Percent of threshold. */
  intensity?: number | null;
  type?: 'WORK' | 'RECOVERY' | string | null;
}

export interface IntervalsIntervalsResponse {
  icu_intervals?: IntervalsInterval[] | null;
}

/** One stream from `GET /activity/{id}/streams?types=heartrate,time`. */
export interface IntervalsStream {
  type: string;
  data: number[];
}

/**
 * A wellness day from `GET /athlete/{id}/wellness`.
 *
 * `id` is the DATE ("2026-08-03"), not a row identifier — an easy thing to
 * misread.
 *
 * bodyBattery / readiness / stress / respiration / spO2 / avgSleepingHR are
 * absent on purpose: Garmin-native composites that were empty across all 366
 * probed days.
 */
export interface IntervalsWellness {
  id: string;
  /** Fitness. */
  ctl?: number | null;
  /** Fatigue. Form is ctl - atl. */
  atl?: number | null;
  restingHR?: number | null;
  hrv?: number | null;
  sleepSecs?: number | null;
  sleepScore?: number | null;
  sleepQuality?: number | null;
  /** Kilograms. */
  weight?: number | null;
  steps?: number | null;
  vo2max?: number | null;
}
