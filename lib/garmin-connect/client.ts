/**
 * Garmin Connect client — the API the Garmin Connect apps use, NOT an official
 * developer API (2026-11-21). The athlete chose it because it is the only way
 * found to put exercise names on the watch: intervals.icu's Garmin upload
 * drops every step's text (measured on the watch's FIT files).
 *
 * Auth follows the flow the open-source `garth` library documents:
 *   login (on the athlete's machine, scripts/garmin-connect-login.ts)
 *     -> SSO ticket -> OAuth1 token (≈1 year, stored encrypted)
 *   OAuth1 token -> OAuth2 access token (≈1 day, cached encrypted)
 *   data calls: `Authorization: Bearer <OAuth2>` on connectapi.garmin.com
 *
 * It can break whenever Garmin changes it. Callers treat every failure as
 * "not pushed" and keep the intervals.icu path untouched.
 */

import { oauth1Header } from '@/lib/garmin-connect/oauth1';

export const CONNECT_API = 'https://connectapi.garmin.com';
const OAUTH_BASE = `${CONNECT_API}/oauth-service/oauth`;
/** The token service expects the Android app's agent. */
const MOBILE_UA = 'com.garmin.android.apps.connectmobile';
/** Data calls use the iOS app's agent, as garth does. */
export const API_UA = 'GCM-iOS-5.7.2.1';
const TIMEOUT_MS = 20_000;
/** Refresh the access token this long before it expires. */
const EXPIRY_MARGIN_MS = 10 * 60 * 1000;

export interface GarminConsumer { consumer_key: string; consumer_secret: string }
export interface GarminOAuth1 { oauth_token: string; oauth_token_secret: string; mfa_token?: string | null }
export interface GarminOAuth2 {
  access_token: string;
  token_type?: string;
  refresh_token?: string;
  expires_in: number;
  /** Epoch ms, added on receipt. */
  expires_at_ms: number;
}

export class GarminConnectError extends Error {
  constructor(message: string, readonly status: number, readonly path: string) {
    super(message);
    this.name = 'GarminConnectError';
  }
}

type Fetch = typeof fetch;

function creds(consumer: GarminConsumer, oauth1?: GarminOAuth1) {
  return {
    consumerKey: consumer.consumer_key,
    consumerSecret: consumer.consumer_secret,
    token: oauth1?.oauth_token,
    tokenSecret: oauth1?.oauth_token_secret,
  };
}

/** SSO ticket -> OAuth1 token. */
export async function preauthorize(ticket: string, consumer: GarminConsumer, fetchImpl: Fetch = fetch): Promise<GarminOAuth1> {
  const url = `${OAUTH_BASE}/preauthorized?ticket=${encodeURIComponent(ticket)}` +
    `&login-url=${encodeURIComponent('https://sso.garmin.com/sso/embed')}&accepts-mfa-tokens=true`;
  const res = await fetchImpl(url, {
    headers: { Authorization: oauth1Header(creds(consumer), { method: 'GET', url }), 'User-Agent': MOBILE_UA },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new GarminConnectError(`OAuth1 preauthorize failed (${res.status})`, res.status, '/oauth/preauthorized');
  const q = new URLSearchParams(text);
  const token = q.get('oauth_token');
  const secret = q.get('oauth_token_secret');
  if (!token || !secret) throw new GarminConnectError('OAuth1 preauthorize returned no token', res.status, '/oauth/preauthorized');
  return { oauth_token: token, oauth_token_secret: secret, mfa_token: q.get('mfa_token') };
}

/** OAuth1 token -> a fresh OAuth2 access token. */
export async function exchangeOAuth2(oauth1: GarminOAuth1, consumer: GarminConsumer, fetchImpl: Fetch = fetch, now = Date.now()): Promise<GarminOAuth2> {
  const url = `${OAUTH_BASE}/exchange/user/2.0`;
  const form: Record<string, string> = oauth1.mfa_token ? { mfa_token: oauth1.mfa_token } : {};
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: oauth1Header(creds(consumer, oauth1), { method: 'POST', url, form }),
      'User-Agent': MOBILE_UA,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const hint = res.status === 401 ? ' — the Garmin Connect sign-in has expired; run scripts/garmin-connect-login.ts again' : '';
    throw new GarminConnectError(`OAuth2 exchange failed (${res.status})${hint}`, res.status, '/oauth/exchange');
  }
  const json = (await res.json()) as Omit<GarminOAuth2, 'expires_at_ms'>;
  if (!json?.access_token) throw new GarminConnectError('OAuth2 exchange returned no access token', res.status, '/oauth/exchange');
  return { ...json, expires_at_ms: now + Number(json.expires_in ?? 3600) * 1000 };
}

export interface GarminConnectClientOptions {
  consumer: GarminConsumer;
  oauth1: GarminOAuth1;
  oauth2?: GarminOAuth2 | null;
  /** Called after a fresh exchange so the token can be cached (encrypted). */
  onOAuth2?: (t: GarminOAuth2) => Promise<void> | void;
  fetchImpl?: Fetch;
}

export class GarminConnectClient {
  private oauth2: GarminOAuth2 | null;
  private readonly fetchImpl: Fetch;

  constructor(private readonly opts: GarminConnectClientOptions) {
    this.oauth2 = opts.oauth2 ?? null;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async bearer(force = false): Promise<string> {
    if (!force && this.oauth2 && this.oauth2.expires_at_ms - EXPIRY_MARGIN_MS > Date.now()) return this.oauth2.access_token;
    this.oauth2 = await exchangeOAuth2(this.opts.oauth1, this.opts.consumer, this.fetchImpl);
    await this.opts.onOAuth2?.(this.oauth2);
    return this.oauth2.access_token;
  }

  /** Authorised request; one retry with a fresh token on 401. Returns parsed JSON, or null for an empty body. */
  async request<T>(method: string, path: string, body?: unknown): Promise<T | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.bearer(attempt > 0);
      const res = await this.fetchImpl(`${CONNECT_API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': API_UA,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 401 && attempt === 0) continue;
      const text = await res.text();
      if (!res.ok) {
        const bare = path.split('?')[0];
        throw new GarminConnectError(`Garmin Connect ${method} ${bare} failed (${res.status}): ${text.slice(0, 200)}`, res.status, bare);
      }
      return text.trim() ? (JSON.parse(text) as T) : null;
    }
    throw new GarminConnectError('Garmin Connect refused the token twice (401)', 401, path.split('?')[0]);
  }

  async createWorkout<T extends { workoutId?: number }>(workout: unknown): Promise<T> {
    const r = await this.request<T>('POST', '/workout-service/workout', workout);
    if (!r?.workoutId) throw new GarminConnectError('Garmin Connect created no workout id', 0, '/workout-service/workout');
    return r;
  }

  async getWorkout<T = unknown>(workoutId: number | string): Promise<T | null> {
    return this.request<T>('GET', `/workout-service/workout/${workoutId}`);
  }

  /** Put a workout on the Garmin calendar for a day (YYYY-MM-DD). */
  async scheduleWorkout(workoutId: number | string, date: string): Promise<{ workoutScheduleId?: number } | null> {
    return this.request('POST', `/workout-service/schedule/${workoutId}`, { date });
  }

  async deleteWorkout(workoutId: number | string): Promise<void> {
    await this.request('DELETE', `/workout-service/workout/${workoutId}`);
  }
}
