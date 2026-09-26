/**
 * When a plan's week 1 is. Dependency-free so the single-call generate
 * routes share the rule with the staged builder.
 */

/**
 * The Sunday week 1 begins. Built Sunday-Tuesday, the plan starts this week
 * (most of it is ahead); built Wednesday-Saturday, it starts next Sunday.
 * Pure, so the rule is testable.
 */
export function planStartSunday(today: string): string {
  const d = new Date(`${today}T12:00:00Z`);
  const dow = d.getUTCDay(); // 0 = Sunday
  const offset = dow <= 2 ? -dow : 7 - dow;
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

const fmtDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "Sun 27 Sep 2026 – Sat 3 Oct 2026" for week 1. */
export function weekOneLabel(startDate: string): string {
  const end = new Date(`${startDate}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  return `${fmtDate(startDate)} – ${fmtDate(end.toISOString().slice(0, 10))}`;
}
