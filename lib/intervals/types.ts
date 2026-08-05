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
   * LOCAL wall-clock time, no offset — e.g. "2026-08-03T06:12:34".
   * Must go through `utcFromUserLocal` before it touches the database.
   */
  start_date_local: string;
  /** Metres. */
  distance: number;
  /** Seconds. */
  moving_time: number;
  average_heartrate?: number | null;
  max_heartrate?: number | null;
  calories?: number | null;
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

  // Richer than Strava ever provided. Not in the `laps` schema yet — adding
  // `intensity` and `gap` would sharpen the weekly-review per-rep commentary.
  min_heartrate?: number | null;
  /** Grade-adjusted pace. */
  gap?: number | null;
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
