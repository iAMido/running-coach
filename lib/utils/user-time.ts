/**
 * User-timezone date helpers.
 *
 * Vercel runs in UTC; the athlete lives in Israel (UTC+2/+3). Every
 * "what day is it" / "which week is this" computation done with a bare
 * `new Date()` was answering in server time — so between midnight and
 * ~03:00 Israel time on Sunday, the server still thought it was Saturday
 * and resolved the PREVIOUS training week (wrong phase in the prompt,
 * weekly summary keyed to the wrong week, Sunday-night runs bucketed
 * into last week's volume).
 *
 * The CalTrack dashboard already solved this (lib/db/caltrack-date.ts);
 * this is the coach-side equivalent. Use these for any day/week boundary
 * math on the server. Client components can keep using `new Date()` —
 * the browser is already in the user's timezone.
 *
 * Single-user app → timezone is a constant. If multi-user ever happens,
 * thread athlete_profile.timezone through instead.
 */

export const USER_TIMEZONE = 'Asia/Jerusalem';

/**
 * A Date whose calendar fields (getDay / getDate / getHours…) reflect the
 * user's timezone regardless of the server's. The absolute epoch value is
 * intentionally shifted — use ONLY for calendar math, never for storing
 * timestamps.
 */
export function nowInUserTz(): Date {
  return dateInUserTz(new Date());
}

/** Shift an instant so its calendar fields read in the user's timezone. */
export function dateInUserTz(d: Date): Date {
  return new Date(d.toLocaleString('en-US', { timeZone: USER_TIMEZONE }));
}

/** YYYY-MM-DD for an instant, evaluated in the user's timezone. */
export function userDateStr(d: Date = new Date()): string {
  // en-CA gives ISO-style YYYY-MM-DD directly.
  return d.toLocaleDateString('en-CA', { timeZone: USER_TIMEZONE });
}

/**
 * YYYY-MM-DD for a calendar day N days before today, in the user's timezone.
 *
 * Proper calendar arithmetic: the fields are already in the user's zone, and
 * `setDate` handles month and year rollover. Subtracting `n * 86400000` from an
 * instant would drift by an hour across a DST boundary and can land on the
 * wrong date.
 */
export function userDateStrDaysAgo(days: number): string {
  const d = nowInUserTz();
  d.setDate(d.getDate() - days);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * What wall-clock time does `timeZone` read at this instant, expressed as the
 * epoch ms of those same calendar fields interpreted as UTC.
 *
 * Subtracting the true instant from this gives the zone's UTC offset at that
 * moment, which is what makes the conversion below DST-aware.
 */
function wallClockAsUtcMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const f: Record<string, string> = {};
  for (const { type, value } of parts) f[type] = value;

  // Some ICU builds render midnight as hour "24".
  const hour = f.hour === '24' ? 0 : Number(f.hour);
  return Date.UTC(Number(f.year), Number(f.month) - 1, Number(f.day), hour, Number(f.minute), Number(f.second));
}

/**
 * Convert a naive local wall-clock timestamp in the user's timezone to a true
 * UTC instant.
 *
 * intervals.icu returns `start_date_local` — "2026-08-03T06:12:34" with no
 * offset, meaning 06:12 *in Israel*. Storing that string directly into a
 * timestamptz column tells Postgres it is 06:12 UTC, shifting every run by 2-3
 * hours. That is precisely the bug that produced the six duplicate pairs Phase 0
 * had to merge, so this conversion is not optional.
 *
 * DST-aware by construction: Israel is UTC+2 in winter and UTC+3 in summer, and
 * the offset is measured at the instant in question rather than assumed. The two
 * passes are a fixed-point settle — the first guess can land on the wrong side
 * of a DST transition, and the second corrects it.
 *
 * During the one ambiguous hour at autumn fall-back the earlier of the two
 * possible instants is chosen; there is no information in a naive timestamp to
 * do better, and a 1-hour error one night a year does not affect any day or week
 * boundary this app computes.
 */
export function utcFromUserLocal(localWallTime: string): string {
  // Strip any trailing zone designator so the fields parse as naive.
  const naive = localWallTime.trim().replace(/(Z|[+-]\d{2}:?\d{2})$/, '');
  const naiveMs = Date.parse(`${naive}Z`);
  if (!Number.isFinite(naiveMs)) {
    throw new Error(`Unparseable local timestamp: ${localWallTime}`);
  }

  let instantMs = naiveMs;
  for (let pass = 0; pass < 2; pass++) {
    const offsetMs = wallClockAsUtcMs(new Date(instantMs), USER_TIMEZONE) - instantMs;
    instantMs = naiveMs - offsetMs;
  }

  return new Date(instantMs).toISOString();
}
