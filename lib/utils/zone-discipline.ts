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

/** Above this share of time beyond the planned ceiling, flag it. */
export const ABOVE_TARGET_FLAG_PCT = 30;

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
  const band = parsePlannedZoneBand(input.targetHr);
  const zonesKnown = hasZoneData(input.zones);
  const zones = input.zones ?? {};

  if (!band) {
    // Planned, but the plan gave no HR target to compare against.
    if (input.plannedType) {
      return zonesKnown
        ? `[planned ${input.plannedType} · no HR zone target in plan]`
        : `[planned ${input.plannedType} · no HR zone target, no zone data]`;
    }
    return zonesKnown ? '[unplanned run]' : '[unplanned run · no zone data]';
  }

  if (!zonesKnown) {
    return `[planned ${band.label} · no zone data for this run — cannot judge intensity]`;
  }

  const round = (n: number) => Math.round(n);
  const inBand = sumZones(zones, band.floor, band.ceiling);
  const aboveCeiling = band.ceiling < 6 ? sumZones(zones, band.ceiling + 1, 6) : 0;

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

  const flag = aboveCeiling > ABOVE_TARGET_FLAG_PCT ? ' — ran above target' : '';
  return `[planned ${band.label} · actual ${parts.join(', ')}${flag}]`;
}
