/**
 * Race pace derived from the athlete's stated goal.
 *
 * ## Why this exists
 *
 * `buildCoachSystemPrompt` hardcoded a pace table headed "for sub-2hr HM goal =
 * 5:40/km race pace" and fed it to plan adjustment for every athlete, every
 * goal, forever. It was wrong in two directions at once: this athlete's stated
 * half-marathon goal is **1:50**, which is 5:13/km rather than 5:40 — nearly
 * half a minute per kilometre out, enough to move every derived training pace
 * into the wrong zone — and he is currently building for a 21K mountain race
 * where a flat-road race pace means nothing at all.
 *
 * A hardcoded number presented as a calculation is the same failure as a
 * hardcoded training-day default: it reads plausibly, so nobody checks it.
 *
 * Returns null when the goal cannot be parsed, and callers must then omit the
 * pace block rather than substitute a default. "No race pace on file" is a
 * usable fact; a confidently wrong one is not.
 */

/** Standard race distances, km. */
const DISTANCES: { pattern: RegExp; km: number; label: string }[] = [
  // Marathon must be tested before "half marathon" would match on "marathon",
  // so the half pattern is anchored on the qualifier.
  { pattern: /\bhalf|\bhm\b|21\s*\.?\d*\s*k/i, km: 21.0975, label: 'half marathon' },
  { pattern: /\bmarathon\b|\b42\s*\.?\d*\s*k/i, km: 42.195, label: 'marathon' },
  { pattern: /\b10\s*k\b/i, km: 10, label: '10K' },
  { pattern: /\b5\s*k\b/i, km: 5, label: '5K' },
];

/**
 * Terrain that makes a flat race pace meaningless.
 *
 * Found by probing the real profile: "21K trail race, 1300m gain" matched the
 * half-marathon distance pattern on "21K", then picked up the "1:50" from the
 * athlete's *secondary road* goal in the same field — producing a confident
 * 5:13/km road pace for a mountain race. Distance alone does not identify a
 * race; a 21 km road half and a 21 km / 1300 m mountain race share a number
 * and nothing else, which is the whole premise of this build.
 */
export const TERRAIN_WITHOUT_FLAT_PACE = new RegExp(
  [
    '\\btrail',
    '\\bmountain',
    '\\bfell\\b',
    '\\bskyrace',
    '\\bultra\\b',
    '\\bvert(?:ical)?\\b',
    'elevation gain',
    '\\bd\\+',
    // "1300m gain", "1300 m of climb" — the shape a race profile is written in.
    '\\d+\\s*m\\s*(?:of\\s*)?(?:gain|climb|ascent|elevation)',
  ].join('|'),
  'i',
);

export interface GoalPace {
  /** Race pace in min/km. */
  paceMinKm: number;
  distanceKm: number;
  distanceLabel: string;
  /** Total goal time in minutes. */
  totalMinutes: number;
  /** The text this was derived from, so a prompt can show its work. */
  source: string;
}

/**
 * Pull a goal time out of free text.
 *
 * Handles "1:50", "1:50:00", "sub 1:50", "52:00", "sub-2hr", "under 2 hours".
 * Ambiguity is resolved toward the plausible: a bare "2:00" against a marathon
 * goal is 2 hours, not 2 minutes, and "52:00" against a 10K is 52 minutes.
 */
export function parseGoalMinutes(text: string, distanceKm: number): number | null {
  // h:mm:ss
  const hms = text.match(/(\d{1,2}):(\d{2}):(\d{2})/);
  if (hms) return Number(hms[1]) * 60 + Number(hms[2]) + Number(hms[3]) / 60;

  // "sub 2hr" / "under 2 hours" / "2hr"
  const hours = text.match(/(?:sub|under)?\s*-?\s*(\d(?:\.\d)?)\s*(?:hr|hour)/i);
  if (hours) return Number(hours[1]) * 60;

  // h:mm or mm:ss — decide by whether the distance could plausibly take that long.
  const two = text.match(/(\d{1,2}):(\d{2})/);
  if (two) {
    const asHours = Number(two[1]) * 60 + Number(two[2]);
    const asMinutes = Number(two[1]) + Number(two[2]) / 60;
    // A pace under 2:30/km is not a human running; under 12:00/km on a race is
    // implausibly slow for a goal. Pick whichever reading lands in range.
    const hoursPace = asHours / distanceKm;
    const minutesPace = asMinutes / distanceKm;
    const plausible = (p: number) => p >= 2.5 && p <= 12;
    if (plausible(hoursPace) && !plausible(minutesPace)) return asHours;
    if (plausible(minutesPace) && !plausible(hoursPace)) return asMinutes;
    // Both or neither: the larger reading is the safer default, since a goal
    // time is far more often stated in h:mm than mm:ss.
    return asHours;
  }

  return null;
}

/**
 * Derive race pace from goal text such as "sub 1:50 half marathon".
 *
 * `extra` lets a caller supply a target time held separately from the goal
 * description — the plan form has its own field for it.
 */
export function goalPace(goalText: string | null | undefined, extra?: string | null): GoalPace | null {
  const text = [goalText, extra].filter(Boolean).join(' ');
  if (!text.trim()) return null;

  // A pace target on terrain is not a pace target. Refuse rather than emit a
  // road pace the athlete will be measured against on a climb.
  if (TERRAIN_WITHOUT_FLAT_PACE.test(text)) return null;

  const distance = DISTANCES.find((d) => d.pattern.test(text));
  if (!distance) return null;

  const totalMinutes = parseGoalMinutes(text, distance.km);
  if (totalMinutes === null || totalMinutes <= 0) return null;

  const paceMinKm = totalMinutes / distance.km;
  // Reject anything outside human racing range rather than emit it. A parse
  // that produces 0.4 min/km is a parse that failed.
  if (paceMinKm < 2.5 || paceMinKm > 12) return null;

  const hours = Math.floor(totalMinutes / 60);
  const mins = Math.round(totalMinutes % 60);
  const time = hours > 0 ? `${hours}:${String(mins).padStart(2, '0')}` : `${mins} min`;
  return {
    paceMinKm,
    distanceKm: distance.km,
    distanceLabel: distance.label,
    totalMinutes,
    // Short and reconstructed, not the raw goal field — that field holds
    // paragraphs and would swamp the prompt header it appears in.
    source: `${time} ${distance.label}`,
  };
}

/** min/km as "5:13". */
export function formatPaceMinKm(paceMinKm: number): string {
  const totalSec = Math.round(paceMinKm * 60);
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`;
}

/**
 * The pace-zone block for a prompt, or a plain statement that there is none.
 *
 * Percentages are of race pace and follow the Triphasic support-phase model
 * the previous hardcoded table used — the structure was never the problem, the
 * frozen 5:40/km was.
 */
export function formatGoalPaceBlock(goal: GoalPace | null): string {
  if (!goal) {
    return [
      '## PACE ZONES',
      'No race-pace target could be derived from this athlete\'s stated goal.',
      'Do NOT assume one. Prescribe by heart-rate zone and effort, and say that',
      'pace targets are unavailable rather than inventing a race pace.',
    ].join('\n');
  }

  const p = goal.paceMinKm;
  const at = (pct: number) => formatPaceMinKm(p / pct);
  return [
    `## PACE ZONES (derived from the athlete's own goal: ${goal.source})`,
    `- ${goal.distanceLabel} race pace: ${formatPaceMinKm(p)} min/km`,
    `- Fast quality (106-114% of race pace): ${at(1.14)}-${at(1.06)} min/km`,
    `- Endurance quality (86-94% of race pace): ${at(0.94)}-${at(0.86)} min/km`,
    `- Easy: ${at(0.78)} min/km or slower`,
    '',
    'These are computed from the goal above, not assumed. If the goal changes,',
    'they change. On steep terrain they do not apply at all — prescribe by',
    'effort and vertical gain instead.',
  ].join('\n');
}
