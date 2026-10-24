/**
 * Garmin Connect Personal API response shapes — only the fields this app reads.
 *
 * Field names were measured on the athlete's account on 2026-10-24
 * (docs/garmin-personal-probe-findings.md). Everything is optional and
 * nullable: the mapper treats any missing field as "not measured".
 */

/** One day from `GET /hrv-service/hrv/daily/{from}/{to}` → `hrvSummaries[]`. */
export interface GarminHrvSummary {
  calendarDate: string;
  weeklyAvg?: number | null;
  lastNightAvg?: number | null;
  lastNight5MinHigh?: number | null;
  baseline?: {
    lowUpper?: number | null;
    balancedLow?: number | null;
    balancedUpper?: number | null;
    markerValue?: number | null;
  } | null;
  /** BALANCED / UNBALANCED / LOW / POOR, as Garmin returns it. */
  status?: string | null;
  feedbackPhrase?: string | null;
}

export interface GarminHrvRange {
  hrvSummaries?: GarminHrvSummary[] | null;
}

/** One day from `GET /usersummary-service/v2/dailysummaries` → `data[]`. */
export interface GarminDailySummary {
  calendarDate: string;
  heartRate?: { minValue?: number | null; maxValue?: number | null; restingValue?: number | null } | null;
  stress?: {
    avgLevel?: number | null;
    maxLevel?: number | null;
    qualifier?: string | null;
    highStressDurationInMillis?: number | null;
  } | null;
  bodyBattery?: {
    minValue?: number | null;
    maxValue?: number | null;
    chargedValue?: number | null;
    drainedValue?: number | null;
    latestValue?: number | null;
  } | null;
  respiration?: { avgValue?: number | null } | null;
  pulseOx?: { avgValue?: number | null } | null;
}

export interface GarminDailySummaries {
  data?: GarminDailySummary[] | null;
}

/** A score inside `sleepScores` — an object carrying `value` (measured), or a bare number. */
export type GarminScore = { value?: number | null; qualifierKey?: string | null } | number | null;

/** `GET /sleep-service/sleep/dailySleep?date=` — the DTO at the top level. */
export interface GarminDailySleep {
  calendarDate?: string | null;
  sleepTimeSeconds?: number | null;
  deepSleepSeconds?: number | null;
  lightSleepSeconds?: number | null;
  remSleepSeconds?: number | null;
  awakeSleepSeconds?: number | null;
  awakeCount?: number | null;
  avgSleepStress?: number | null;
  avgHeartRate?: number | null;
  averageRespirationValue?: number | null;
  averageSpO2Value?: number | null;
  /** Epoch ms. */
  sleepStartTimestampGMT?: number | string | null;
  sleepEndTimestampGMT?: number | string | null;
  sleepScores?: { overall?: GarminScore } | null;
  /** Minutes. */
  sleepNeed?: { actual?: number | null; baseline?: number | null } | null;
}

/** One day from `GET /wellness-service/wellness/bodyBattery/reports/daily` (max 28 days per call). */
export interface GarminBodyBatteryReport {
  date: string;
  charged?: number | null;
  drained?: number | null;
  /** Rows described by `bodyBatteryValueDescriptorDTOList`, e.g. [timestamp, level]. */
  bodyBatteryValuesArray?: (number | string | null)[][] | null;
  bodyBatteryValueDescriptorDTOList?:
    | { bodyBatteryValueDescriptorIndex?: number; bodyBatteryValueDescriptorKey?: string }[]
    | null;
}
