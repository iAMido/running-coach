/**
 * Israel-local YYYY-MM-DD helpers for CalTrack daily_summary refreshes.
 *
 * Why this exists:
 *   The dashboard's add/edit/delete routes used to derive the summary
 *   date with `new Date(eaten_at).toISOString().split('T')[0]`. That
 *   returns the UTC date, so a meal logged at Israel-time 00:30 (which
 *   is 21:30 UTC the previous day) refreshed the WRONG day's summary
 *   row. Use these helpers instead.
 */

const TZ = 'Asia/Jerusalem';

/**
 * Return YYYY-MM-DD for the given ISO timestamp, in Israel local time.
 *
 * Uses `en-CA` formatting (always YYYY-MM-DD) with explicit timeZone.
 * If `iso` is undefined or unparseable, returns today's Israel-local date.
 */
export function israelDateFromIso(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  if (isNaN(d.getTime())) {
    return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  }
  return d.toLocaleDateString('en-CA', { timeZone: TZ });
}
