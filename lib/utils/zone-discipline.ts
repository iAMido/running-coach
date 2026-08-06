/**
 * Intent versus actual: what the plan asked for against what the zones say.
 *
 * The app has held both halves of this comparison since zones existed and has
 * never made it, while the system prompt calls 80/20 non-negotiable.
 *
 * ## Intent comes from the PLAN, never from run_type
 *
 * `classifyRun` takes `zonePercents` as an input, so comparing `run_type`
 * against the zone distribution measures the classifier against its own input.
 * It would read as insight and mean nothing. Intent is read from the planned
 * workout's `target_hr`.
 *
 * ## Only the zone label is used — the bpm in parentheses is ignored
 *
 * A plan's `target_hr` looks like `"Z1-Z2 (125-145)"`. Those numbers were
 * generated under the old max-HR-185 bands; `pct_z1..z6` are now computed
 * against max 191 (`0-124 / 124-143 / 143-155 / 155-168 / 168-181 / 181-191`).
 * Comparing the two would silently compare two different definitions of the
 * same zone. The label survives that change; the bpm does not.
 *
 * ## It states numbers, it does not grade
 *
 * One flag only, when time above the planned ceiling exceeds 30%. Any finer
 * threshold would be invented today on a sample of 27 runs — the same reason
 * the decoupling bands are rendered as percentiles rather than verdicts.
 */

export interface ZoneDistribution {
  pct_z1?: number | null;
  pct_z2?: number | null;
  pct_z3?: number | null;
  pct_z4?: number | null;
  pct_z5?: number | null;
  pct_z6?: number | null;
}

export interface PlannedZoneBand {
  /** Normalised label, e.g. "Z1-Z2" or "Z4". */
  label: string;
  floor: number;
  ceiling: number;
}

/** Above this share of time beyond the planned band, flag it. Applied
 *  symmetrically to overshoot and undershoot rather than inventing a second
 *  number. */
export const OFF_TARGET_FLAG_PCT = 30;

/**
 * Which sessions are judged against the 80/20 easy band rather than the
 * literal `target_hr` label.
 *
 * The plan's own labels are not trustworthy: it writes `"Z1 (115-135)"` for
 * easy runs, but under current bands Z1 is 0-124 and Z2 is 124-143, so that
 * bpm range spans two zones — the label and its own numbers disagreed when it
 * was generated. Six of eleven planned days prescribe bare Z1, which for a
 * 45-minute run asks for near-walking.
 *
 * The session TYPE is reliable in a way the label is not: the plan generator
 * wrote it independently of any actual run, so unlike `runs.run_type` it is not
 * derived from the zone distribution and comparing against it is not circular.
 *
 * Judging easy days against Z1+Z2 is not an invented threshold — 80/20 is
 * declared non-negotiable in COACH_STATIC_BLOCK and Z1+Z2 is this app's own
 * easy band. It applies a principle the system already holds.
 */
const EASY_SESSION = /easy|recovery|long run|base|aerobic|jog|shakeout|steady/i;

/**
 * Quality sessions, where hitting the intensity is the point. These get the
 * undershoot flag; an easy run cannot meaningfully undershoot, since running
 * easier than prescribed is not a training error.
 */
const QUALITY_SESSION = /tempo|threshold|interval|vo2|speed|fartlek|pyramid|race|hill|surge/i;

/** The 80/20 easy band. */
const EASY_BAND: PlannedZoneBand = { label: 'Z1-Z2', floor: 1, ceiling: 2 };

/**
 * Read the zone band from a plan's `target_hr`.
 *
 * The parenthetical bpm range is stripped before matching, so a stray
 * "(125-145)" can never be read as zone numbers.
 */
export function parsePlannedZoneBand(targetHr: string | null | undefined): PlannedZoneBand | null {
  if (!targetHr) return null;

  const withoutBpm = targetHr.replace(/\([^)]*\)/g, ' ');
  // Second Z is optional: "Z1-Z2", "Z1 - Z2", "Z1-2" and "Z1" all parse.
  const match = /z\s*([1-6])(?:\s*[-–—to]+\s*z?\s*([1-6]))?/i.exec(withoutBpm);
  if (!match) return null;

  const first = Number(match[1]);
  const second = match[2] ? Number(match[2]) : first;
  const floor = Math.min(first, second);
  const ceiling = Math.max(first, second);

  return { label: floor === ceiling ? `Z${floor}` : `Z${floor}-Z${ceiling}`, floor, ceiling };
}

function zoneAt(zones: ZoneDistribution, n: number): number {
  const value = (zones as Record<string, number | null | undefined>)[`pct_z${n}`];
  return typeof value === 'number' ? value : 0;
}

function sumZones(zones: ZoneDistribution, from: number, to: number): number {
  let total = 0;
  for (let n = from; n <= to; n++) total += zoneAt(zones, n);
  return total;
}

/** True when the row genuinely carries zone data (null ≠ 0 — see below). */
export function hasZoneData(zones: ZoneDistribution | null | undefined): boolean {
  return !!zones && typeof zones.pct_z1 === 'number';
}

export interface ZoneDisciplineInput {
  /** The plan's `target_hr` for that day, or null when unplanned. */
  targetHr?: string | null;
  /** The planned workout's type, for context in the rendered line. */
  plannedType?: string | null;
  zones?: ZoneDistribution | null;
}

/**
 * One bracketed line for a run block, or '' when there is nothing to say.
 *
 * Both absences are stated rather than skipped:
 *
 * - **No zones.** 560 runs were nulled because their zone data was
 *   demonstrably wrong. Rendering a null as "0% Z4+" would read as a
 *   perfectly-controlled easy run on precisely the runs that cannot be judged.
 * - **No planned workout** (rest day, off-plan, outside the plan window). Left
 *   out entirely, an unplanned run looks like a compliant one.
 */
export function formatZoneDiscipline(input: ZoneDisciplineInput): string {
  const type = input.plannedType ?? '';
  const isEasy = EASY_SESSION.test(type);
  const isQuality = !isEasy && QUALITY_SESSION.test(type);

  // Easy sessions are judged against the 80/20 band. Everything else falls
  // back to the plan's own label, which is all there is to go on.
  const band = isEasy ? EASY_BAND : parsePlannedZoneBand(input.targetHr);
  const zonesKnown = hasZoneData(input.zones);
  const zones = input.zones ?? {};

  // How the intent is described: type when there is one, since it is the
  // reliable field, with the band appended for quality work where the specific
  // zones are the point.
  const intent = type
    ? isEasy
      ? `${type} (easy: Z1-Z2)`
      : band
        ? `${type} ${band.label}`
        : type
    : band?.label ?? '';

  if (!band) {
    if (type) {
      return zonesKnown
        ? `[planned ${type} · no HR zone target in plan]`
        : `[planned ${type} · no HR zone target, no zone data]`;
    }
    return zonesKnown ? '[unplanned run]' : '[unplanned run · no zone data]';
  }

  if (!zonesKnown) {
    return `[planned ${intent} · no zone data for this run — cannot judge intensity]`;
  }

  const round = (n: number) => Math.round(n);
  const inBand = sumZones(zones, band.floor, band.ceiling);
  const aboveCeiling = band.ceiling < 6 ? sumZones(zones, band.ceiling + 1, 6) : 0;
  const belowFloor = band.floor > 1 ? sumZones(zones, 1, band.floor - 1) : 0;

  const parts = [`${round(inBand)}% ${band.label}`];

  const next = band.ceiling + 1;
  if (next <= 6) {
    parts.push(`${round(zoneAt(zones, next))}% Z${next}`);
    const restFrom = next + 1;
    if (restFrom <= 6) {
      const restLabel = restFrom === 6 ? 'Z6' : `Z${restFrom}+`;
      parts.push(`${round(sumZones(zones, restFrom, 6))}% ${restLabel}`);
    }
  }

  let flag = '';
  if (aboveCeiling > OFF_TARGET_FLAG_PCT) {
    flag = ' — ran above target';
  } else if (isQuality && belowFloor > OFF_TARGET_FLAG_PCT) {
    // Only quality sessions can fail by being too easy — hitting the intensity
    // is the entire point of them.
    flag = ` — ${round(belowFloor)}% below target intensity`;
  }

  return `[planned ${intent} · actual ${parts.join(', ')}${flag}]`;
}
