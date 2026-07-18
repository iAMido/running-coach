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
