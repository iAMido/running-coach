/**
 * Run type classification based on distance, heart rate, and workout name.
 *
 * Now honors the athlete's actual HR zones from athlete_profile (parsed from
 * "low-high" strings like "138-150") instead of hardcoded thresholds, and
 * actually emits 'Interval' when the workout name signals interval work or
 * the HR profile + lap structure looks interval-like.
 */

import type { AthleteProfile } from '@/lib/db/types';

export type RunType =
  | 'Recovery'
  | 'Easy'
  | 'Moderate'
  | 'Tempo'
  | 'Long Run'
  | 'Race'
  | 'Intervals';

interface ClassifyRunParams {
  distanceKm: number;
  avgHr?: number;
  maxHr?: number;
  durationMin?: number;
  workoutName?: string | null;
  profile?: AthleteProfile | null;
  /**
   * Optional HR-stream-derived zone percentages (0-100). When present the
   * classifier uses these as ground truth instead of the avg HR heuristic.
   */
  zonePercents?: { z1?: number; z2?: number; z3?: number; z4?: number; z5?: number; z6?: number };
  /** Number of laps from the activity (if known). Helps Interval detection. */
  lapCount?: number;
}

interface HrThresholds {
  recovery: number;
  easy: number;
  moderate: number;
  tempo: number;
  threshold: number;
}

const DEFAULT_THRESHOLDS: HrThresholds = {
  recovery: 130,
  easy: 145,
  moderate: 155,
  tempo: 170,
  threshold: 175,
};

/**
 * Heuristics to spot an interval session from its title. Covers common
 * patterns: "5x1k", "8 x 400", "6×800m", "fartlek", "track", "repeats".
 * Hebrew variants intentionally included since the user logs in both.
 */
const INTERVAL_NAME_PATTERNS: RegExp[] = [
  /\binterval/i,
  /\brepeat/i,
  /\bfartlek\b/i,
  /\btrack\b/i,
  /\bvo2\b/i,
  /\d+\s*[x×]\s*\d+\s*(m|k|km|min)?\b/i, // 5x1k / 8 × 400m / 6x3min
  /\bsprint/i,
  /\binterva?ls?\b/i,
  /אינטרוול/, // Hebrew "interval"
];

const TEMPO_NAME_PATTERNS = [/\btempo\b/i, /\bthreshold\b/i, /\blt\b/i, /טמפו/];
const LONG_NAME_PATTERNS = [/\blong\b/i, /ארוך/];
const RECOVERY_NAME_PATTERNS = [/\brecovery\b/i, /\brecov\b/i, /\bshakeout\b/i, /התאוששות/];
const EASY_NAME_PATTERNS = [/\beasy\b/i, /\baerobic\b/i, /קל/];
const RACE_NAME_PATTERNS = [/\brace\b/i, /\bmarathon\b/i, /\bhalf\b/i, /\b5k\b/i, /\b10k\b/i, /מירוץ/];

function parseRange(s: string | undefined | null): { low: number; high: number } | null {
  if (!s) return null;
  // Match "120-138" or "138+"
  const m = s.match(/(\d+)\s*-\s*(\d+)/);
  if (m) return { low: parseInt(m[1], 10), high: parseInt(m[2], 10) };
  const open = s.match(/(\d+)\s*\+/);
  if (open) return { low: parseInt(open[1], 10), high: parseInt(open[1], 10) + 30 };
  return null;
}

/**
 * Build HR thresholds from the athlete's zone strings. Falls back to the
 * legacy hardcoded thresholds if the profile is missing or malformed.
 */
function thresholdsFromProfile(profile: AthleteProfile | null | undefined): HrThresholds {
  if (!profile) return DEFAULT_THRESHOLDS;
  const z2 = parseRange(profile.hr_zone_z2);
  const z3 = parseRange(profile.hr_zone_z3);
  const z4 = parseRange(profile.hr_zone_z4);
  const z5 = parseRange(profile.hr_zone_z5);
  if (!z2 || !z3 || !z4 || !z5) return DEFAULT_THRESHOLDS;
  return {
    recovery: z2.low,       // below Z2 low = recovery
    easy: z3.low,           // below Z3 low = easy
    moderate: z4.low,       // below Z4 low = moderate
    tempo: z5.low,          // below Z5 low = tempo
    threshold: z5.high,     // above Z5 high = threshold/race
  };
}

function matchesAny(name: string | null | undefined, patterns: RegExp[]): boolean {
  if (!name) return false;
  return patterns.some(p => p.test(name));
}

/**
 * Classify a run. Order of checks:
 *   1. Workout name is the strongest signal (athlete-named "5x1k" = Intervals).
 *   2. Zone distribution if available (lots of Z5+ with non-trivial recovery = Intervals).
 *   3. HR + distance heuristics against the athlete's own zones.
 */
export function classifyRun({
  distanceKm,
  avgHr,
  maxHr,
  durationMin,
  workoutName,
  profile,
  zonePercents,
  lapCount,
}: ClassifyRunParams): RunType {
  void maxHr; void durationMin; // reserved for future use

  // 1. Strong name-based signals
  if (matchesAny(workoutName, INTERVAL_NAME_PATTERNS)) return 'Intervals';
  if (matchesAny(workoutName, RACE_NAME_PATTERNS)) return 'Race';
  if (matchesAny(workoutName, RECOVERY_NAME_PATTERNS)) return 'Recovery';
  if (matchesAny(workoutName, TEMPO_NAME_PATTERNS)) return 'Tempo';
  if (matchesAny(workoutName, LONG_NAME_PATTERNS)) return 'Long Run';
  if (matchesAny(workoutName, EASY_NAME_PATTERNS)) return 'Easy';

  // 2. Zone-based interval detection: substantial Z5+ time with at least some
  //    recovery between (proxy: not 100% in Z5), plus multiple laps if known.
  if (zonePercents) {
    const hard = (zonePercents.z4 || 0) + (zonePercents.z5 || 0) + (zonePercents.z6 || 0);
    const recovery = (zonePercents.z1 || 0) + (zonePercents.z2 || 0);
    if (hard > 35 && recovery > 15 && (lapCount === undefined || lapCount >= 4)) {
      return 'Intervals';
    }
  }

  const thresholds = thresholdsFromProfile(profile);

  // 3. Distance-only fallback when HR is missing
  if (!avgHr) {
    if (distanceKm < 5) return 'Easy';
    if (distanceKm >= 15) return 'Long Run';
    return 'Moderate';
  }

  // 4. Recovery: short distance + low HR
  if (distanceKm < 4 && avgHr < thresholds.recovery) return 'Recovery';

  // 5. Long Run: long distance + controlled HR
  if (distanceKm >= 15 && avgHr < thresholds.moderate) return 'Long Run';
  if (distanceKm >= 12 && avgHr < thresholds.tempo) return 'Long Run';

  // 6. Tempo: elevated HR in moderate→tempo band
  if (avgHr >= thresholds.moderate && avgHr <= thresholds.tempo) return 'Tempo';

  // 7. Race: high HR + decent distance
  if (avgHr > thresholds.tempo && distanceKm >= 5) return 'Race';

  // 8. Easy: low HR
  if (avgHr < thresholds.easy) return 'Easy';

  return 'Moderate';
}

/**
 * Get color for run type badge
 */
export function getRunTypeColor(runType: RunType): string {
  const colors: Record<RunType, string> = {
    Recovery: 'bg-gray-500',
    Easy: 'bg-blue-500',
    Moderate: 'bg-green-500',
    Tempo: 'bg-yellow-500',
    'Long Run': 'bg-purple-500',
    Race: 'bg-red-500',
    Intervals: 'bg-orange-500',
  };
  return colors[runType] || 'bg-gray-500';
}

/**
 * Get suggested HR zone for run type
 */
export function getSuggestedHrZone(runType: RunType): string {
  const zones: Record<RunType, string> = {
    Recovery: 'Z1 (< 130 bpm)',
    Easy: 'Z2 (130-145 bpm)',
    Moderate: 'Z3 (145-155 bpm)',
    Tempo: 'Z3-Z4 (155-170 bpm)',
    'Long Run': 'Z2 (130-150 bpm)',
    Race: 'Z4-Z5 (165+ bpm)',
    Intervals: 'Z5 (175+ bpm)',
  };
  return zones[runType] || 'Z2-Z3';
}

/**
 * Calculate intensity distribution from runs
 */
export function calculateIntensityDistribution(
  runs: { run_type?: string }[]
): Record<string, number> {
  const distribution: Record<string, number> = {
    Easy: 0,
    Moderate: 0,
    Hard: 0,
  };

  runs.forEach((run) => {
    const type = run.run_type || 'Moderate';
    if (['Recovery', 'Easy'].includes(type)) {
      distribution.Easy++;
    } else if (['Tempo', 'Race', 'Intervals', 'Interval'].includes(type)) {
      distribution.Hard++;
    } else {
      distribution.Moderate++;
    }
  });

  const total = runs.length || 1;
  return {
    Easy: Math.round((distribution.Easy / total) * 100),
    Moderate: Math.round((distribution.Moderate / total) * 100),
    Hard: Math.round((distribution.Hard / total) * 100),
  };
}
