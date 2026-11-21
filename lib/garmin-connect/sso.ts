/**
 * Garmin SSO sign-in -> OAuth1 token. Runs ONLY on the athlete's own machine
 * (scripts/garmin-connect-login.ts): the password is typed there, sent to
 * sso.garmin.com and nowhere else, and never stored. What is kept is the
 * OAuth1 token it yields.
 *
 * The request sequence is the one the open-source `garth` library uses
 * (embed page for cookies -> signin page for the CSRF token -> signin POST ->
 * optional MFA -> ticket -> OAuth1 preauthorize).
 */

import { preauthorize, type GarminConsumer, type GarminOAuth1 } from '@/lib/garmin-connect/client';

const SSO = 'https://sso.garmin.com';
const SSO_EMBED = `${SSO}/sso/embed`;
const UA = 'GCM-iOS-5.7.2.1';

const EMBED_PARAMS = { id: 'gauth-widget', embedWidget: 'true', gauthHost: `${SSO}/sso` };
const SIGNIN_PARAMS = {
  id: 'gauth-widget', embedWidget: 'true', gauthHost: SSO_EMBED, service: SSO_EMBED, source: SSO_EMBED,
  redirectAfterAccountLoginUrl: SSO_EMBED, redirectAfterAccountCreationUrl: SSO_EMBED,
};

/** Published consumer key/secret of the Garmin Connect mobile app, as garth distributes it. */
export const CONSUMER_URL = 'https://thegarth.s3.amazonaws.com/oauth_consumer.json';

export async function fetchConsumer(fetchImpl: typeof fetch = fetch): Promise<GarminConsumer> {
  const res = await fetchImpl(CONSUMER_URL, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Could not fetch the OAuth consumer (${res.status})`);
  const c = (await res.json()) as GarminConsumer;
  if (!c?.consumer_key || !c?.consumer_secret) throw new Error('OAuth consumer file has no key/secret');
  return c;
}

export function csrfFrom(html: string): string | null {
  return /name="_csrf"\s+value="(.+?)"/.exec(html)?.[1] ?? null;
}
export function titleFrom(html: string): string | null {
  return /<title>(.+?)<\/title>/.exec(html)?.[1] ?? null;
}
export function ticketFrom(html: string): string | null {
  return /embed\?ticket=([^"]+)"/.exec(html)?.[1] ?? null;
}

/** A minimal cookie jar: name=value pairs, host-agnostic (everything here is sso.garmin.com). */
class Jar {
  private cookies = new Map<string, string>();
  take(res: Response) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

export interface LoginResult { oauth1: GarminOAuth1; consumer: GarminConsumer }

export async function garminLogin(
  email: string,
  password: string,
  promptMfa: () => Promise<string>,
  fetchImpl: typeof fetch = fetch,
): Promise<LoginResult> {
  const jar = new Jar();
  let referer: string | undefined;

  const go = async (url: string, init: { method?: string; form?: Record<string, string> } = {}) => {
    const res = await fetchImpl(url, {
      method: init.method ?? 'GET',
      headers: {
        'User-Agent': UA,
        Cookie: jar.header(),
        ...(referer ? { Referer: referer } : {}),
        ...(init.form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      ...(init.form ? { body: new URLSearchParams(init.form).toString() } : {}),
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
    jar.take(res);
    referer = url;
    const text = await res.text();
    if (res.status === 429) throw new Error('Garmin is rate-limiting sign-ins (429). Wait an hour and try again.');
    if (res.status >= 400) throw new Error(`Garmin sign-in step failed (${res.status}) at ${new URL(url).pathname}`);
    return text;
  };

  const qs = (p: Record<string, string>) => new URLSearchParams(p).toString();
  await go(`${SSO_EMBED}?${qs(EMBED_PARAMS)}`);
  const signinPage = await go(`${SSO}/sso/signin?${qs(SIGNIN_PARAMS)}`);
  const csrf = csrfFrom(signinPage);
  if (!csrf) throw new Error('No CSRF token on the Garmin sign-in page (the page changed?)');

  let html = await go(`${SSO}/sso/signin?${qs(SIGNIN_PARAMS)}`, {
    method: 'POST',
    form: { username: email, password, embed: 'true', _csrf: csrf },
  });
  let title = titleFrom(html) ?? '';

  if (/MFA/i.test(title)) {
    const code = (await promptMfa()).trim();
    const mfaCsrf = csrfFrom(html);
    if (!mfaCsrf) throw new Error('No CSRF token on the MFA page');
    html = await go(`${SSO}/sso/verifyMFA/loginEnterMfaCode?${qs(SIGNIN_PARAMS)}`, {
      method: 'POST',
      form: { 'mfa-code': code, embed: 'true', _csrf: mfaCsrf, fromPage: 'setupEnterMfaCode' },
    });
    title = titleFrom(html) ?? '';
  }

  if (title !== 'Success') {
    throw new Error(`Garmin sign-in did not succeed (page title "${title || 'none'}"). Check the email and password.`);
  }
  const ticket = ticketFrom(html);
  if (!ticket) throw new Error('Signed in, but Garmin returned no ticket');

  const consumer = await fetchConsumer(fetchImpl);
  const oauth1 = await preauthorize(ticket, consumer, fetchImpl);
  return { oauth1, consumer };
}
