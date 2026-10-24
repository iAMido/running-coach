/**
 * Garmin Connect Personal API client (read-only; launched 2026-10-21).
 *
 * Gotchas, each measured on 2026-10-24 (docs/garmin-personal-probe-findings.md):
 *
 *   1. The token exchange takes `Authorization: ApiKey <key>` and NOTHING else.
 *      Adding `Accept: application/json` returns 406 NotAcceptableException,
 *      which reads like a key problem and is not one.
 *   2. The token is a raw ~1.1 KB string valid for 24 h. There is no refresh
 *      token: a new one is minted from the key. Data calls use `Bearer`.
 *   3. Range limits differ per endpoint: HRV and v2 daily summaries accept
 *      60 days in one call, body battery reports max out between 28 and 59
 *      (400 above), and dailySleep is one night per call.
 *
 * Rate limits are undocumented. A 429 throws `GarminRateLimitedError` instead
 * of retrying in a loop: the caller records a cooldown so the next cron run and
 * the next app open both respect it.
 */

import type {
  GarminBodyBatteryReport,
  GarminDailySleep,
  GarminDailySummaries,
  GarminDailySummary,
  GarminHrvRange,
  GarminHrvSummary,
} from '@/lib/garmin/types';

export const GARMIN_BASE_URL = 'https://personal.connectapi.garmin.com';
const TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';

/** Garmin says 24 h. Treat it as expiring an hour early so a sync never starts on a dying token. */
const TOKEN_LIFETIME_MS = 23 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
/** Measured: 28 accepted, 60 rejected. */
export const BODY_BATTERY_MAX_DAYS = 28;

export class GarminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The path only. Headers carry the key or token and are never included. */
    readonly path: string,
  ) {
    super(message);
    this.name = 'GarminApiError';
  }
}

export class GarminRateLimitedError extends GarminApiError {
  constructor(
    path: string,
    readonly retryAfterSec: number | null,
  ) {
    super('Garmin rate limit (429)', 429, path);
    this.name = 'GarminRateLimitedError';
  }
}

export interface GarminCachedToken {
  token: string;
  expiresAt: Date;
}

export interface GarminClientOptions {
  apiKey: string;
  cachedToken?: GarminCachedToken | null;
  /** Called after a fresh exchange, so the token can be persisted and shared between runs. */
  onToken?: (token: GarminCachedToken) => Promise<void> | void;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

function describeError(status: number, path: string): string {
  if (status === 401) return `Garmin rejected the credentials (401) on ${path}. The key may be deleted or expired.`;
  if (status === 403) return `Garmin refused access (403) on ${path}.`;
  if (status === 406) return `Garmin returned 406 on ${path}: an unexpected Accept header.`;
  return `Garmin request failed (${status}) on ${path}`;
}

/** Token responses have been a raw string; accept a JSON wrapper too in case that changes. */
export function parseTokenBody(text: string): string {
  const trimmed = text.trim();
  try {
    const json = JSON.parse(trimmed);
    if (typeof json === 'string') return json;
    const token = json?.access_token ?? json?.accessToken ?? json?.token;
    if (typeof token === 'string' && token) return token;
  } catch {
    // not JSON — a raw token
  }
  if (!trimmed) throw new Error('Garmin token exchange returned an empty body');
  return trimmed;
}

export class GarminClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly onToken?: GarminClientOptions['onToken'];
  private readonly now: () => Date;
  private token: GarminCachedToken | null;

  constructor(options: GarminClientOptions) {
    if (!options.apiKey) throw new Error('Garmin Personal API key is required');
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.onToken = options.onToken;
    this.now = options.now ?? (() => new Date());
    this.token = options.cachedToken ?? null;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    return this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  }

  /** Exchange the key for a fresh access token. Also the cheapest way to validate a key. */
  async exchangeToken(): Promise<GarminCachedToken> {
    const response = await this.fetchWithTimeout(`${GARMIN_BASE_URL}${TOKEN_PATH}`, {
      method: 'POST',
      // No Accept header — see gotcha 1.
      headers: { Authorization: `ApiKey ${this.apiKey}` },
    });
    if (response.status === 429) throw new GarminRateLimitedError(TOKEN_PATH, retryAfter(response));
    if (!response.ok) throw new GarminApiError(describeError(response.status, TOKEN_PATH), response.status, TOKEN_PATH);

    const token = {
      token: parseTokenBody(await response.text()),
      expiresAt: new Date(this.now().getTime() + TOKEN_LIFETIME_MS),
    };
    this.token = token;
    await this.onToken?.(token);
    return token;
  }

  private async ensureToken(): Promise<string> {
    if (this.token && this.token.expiresAt.getTime() > this.now().getTime()) return this.token.token;
    return (await this.exchangeToken()).token;
  }

  /** GET returning parsed JSON, or null for an empty body (a day with nothing recorded). */
  private async get<T>(path: string): Promise<T | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.ensureToken();
      const response = await this.fetchWithTimeout(`${GARMIN_BASE_URL}${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: '*/*' },
      });

      // A cached token can be revoked before its 24 h are up: re-exchange once.
      if (response.status === 401 && attempt === 0) {
        this.token = null;
        continue;
      }
      if (response.status === 429) throw new GarminRateLimitedError(path.split('?')[0], retryAfter(response));
      if (!response.ok) {
        const bare = path.split('?')[0];
        throw new GarminApiError(describeError(response.status, bare), response.status, bare);
      }

      const text = await response.text();
      if (!text.trim()) return null;
      return JSON.parse(text) as T;
    }
    throw new GarminApiError(describeError(401, path.split('?')[0]), 401, path.split('?')[0]);
  }

  /** HRV per night. Dates YYYY-MM-DD inclusive; 60 days per call measured fine. */
  async getHrvRange(from: string, to: string): Promise<GarminHrvSummary[]> {
    const body = await this.get<GarminHrvRange>(`/hrv-service/hrv/daily/${from}/${to}`);
    return body?.hrvSummaries ?? [];
  }

  /** v2 daily summaries: resting HR, stress, body battery, respiration, SpO2. 60 days per call measured fine. */
  async getDailySummaries(from: string, to: string): Promise<GarminDailySummary[]> {
    const body = await this.get<GarminDailySummaries>(
      `/usersummary-service/v2/dailysummaries?startDate=${from}&endDate=${to}`,
    );
    return body?.data ?? [];
  }

  /** Body battery reports with the intraday series. Callers must chunk at BODY_BATTERY_MAX_DAYS. */
  async getBodyBatteryReports(from: string, to: string): Promise<GarminBodyBatteryReport[]> {
    const body = await this.get<GarminBodyBatteryReport[]>(
      `/wellness-service/wellness/bodyBattery/reports/daily?startDate=${from}&endDate=${to}`,
    );
    return Array.isArray(body) ? body : [];
  }

  /** One night, filed under the wake date. Null when nothing was recorded. */
  async getDailySleep(date: string): Promise<GarminDailySleep | null> {
    return this.get<GarminDailySleep>(`/sleep-service/sleep/dailySleep?date=${date}`);
  }
}

function retryAfter(response: Response): number | null {
  const value = Number(response.headers.get('retry-after'));
  return Number.isFinite(value) && value > 0 ? value : null;
}
