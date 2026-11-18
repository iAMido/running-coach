import { timingSafeEqual } from 'crypto';

/**
 * The one check every cron route uses.
 *
 * The old inline form, `header !== \`Bearer ${process.env.CRON_SECRET}\``,
 * accepted the literal header `Bearer undefined` whenever the secret was
 * missing from an environment (a preview deploy, a renamed variable) — and
 * the weekly-proposal cron behind it makes an Opus call per athlete. A missing
 * secret now refuses everything, and the comparison is constant-time.
 */
export function isCronAuthorized(
  authorizationHeader: string | null,
  secret: string | undefined = process.env.CRON_SECRET,
): boolean {
  if (!secret) return false;
  const provided = Buffer.from(authorizationHeader ?? '', 'utf8');
  const expected = Buffer.from(`Bearer ${secret}`, 'utf8');
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
