/**
 * Who may sign in. Google OAuth on its own admits ANY Google account, and
 * every API route trusts any signed-in session: a stranger could spend the
 * OpenRouter budget, read and delete CalTrack meals (those routes act on the
 * single `user_profile` row, whoever is signed in) and upload books into the
 * coach library the coach reads.
 *
 * `ALLOWED_EMAILS` is a comma-separated list. Unset or empty = nobody gets in
 * (fail closed): a missing env var must never silently reopen the app.
 */

export function parseAllowedEmails(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isEmailAllowed(email: string | null | undefined, raw: string | undefined = process.env.ALLOWED_EMAILS): boolean {
  if (!email) return false;
  const allowed = parseAllowedEmails(raw);
  if (allowed.size === 0) {
    console.error('ALLOWED_EMAILS is not set — refusing every sign-in until it is.');
    return false;
  }
  return allowed.has(email.trim().toLowerCase());
}
