/**
 * intervals.icu API client.
 *
 * Three gotchas are baked in here so no caller has to remember them. All three
 * were verified live on 2026-08-05 and each fails in a way that does not
 * resemble its cause:
 *
 *   1. HTTP Basic auth where the username is the LITERAL string "API_KEY" —
 *      not the athlete id, not the key itself. The key is the password.
 *   2. A custom User-Agent is mandatory. Cloudflare 403s default agents
 *      (node-fetch, undici, python-requests), so a 403 on a perfectly valid
 *      key is almost always this and not an authorization problem.
 *   3. An athlete id of "0" means "the authenticated athlete" and works as a
 *      fallback when the configured id is missing.
 *
 * Rate limits are 5,000/day and 2,500/15min — far above this app's volume, but
 * 429 is honoured with backoff anyway.
 */

import type {
  IntervalsActivity,
  IntervalsInterval,
  IntervalsIntervalsResponse,
  IntervalsStream,
  IntervalsWellness,
} from '@/lib/intervals/types';

const BASE_URL = 'https://intervals.icu/api/v1';

/** Cloudflare rejects default agents; this must stay non-empty. */
const USER_AGENT = 'RunCoach/1.0';

/** Basic-auth username is this literal string, not the athlete id. */
const BASIC_AUTH_USERNAME = 'API_KEY';

/** "0" resolves server-side to whoever the key belongs to. */
const SELF_ATHLETE_ID = '0';

const DEFAULT_MAX_RETRIES = 3;

export class IntervalsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = 'IntervalsApiError';
  }
}

export interface IntervalsClientOptions {
  apiKey: string;
  /** Falls back to "0" (the authenticated athlete) when absent. */
  athleteId?: string | null;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  maxRetries?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class IntervalsClient {
  private readonly apiKey: string;
  private readonly athleteId: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;

  constructor(options: IntervalsClientOptions) {
    if (!options.apiKey) throw new Error('intervals.icu API key is required');
    this.apiKey = options.apiKey;
    this.athleteId = options.athleteId?.trim() || SELF_ATHLETE_ID;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  private get authorization(): string {
    return `Basic ${Buffer.from(`${BASIC_AUTH_USERNAME}:${this.apiKey}`).toString('base64')}`;
  }

  private async request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
    let lastError: IntervalsApiError | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const response = await this.fetchImpl(`${BASE_URL}${path}`, {
        method: init?.method ?? 'GET',
        headers: {
          Authorization: this.authorization,
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
      });

      if (response.ok) return (await response.json()) as T;

      const body = await response.text().catch(() => '');

      // Throttled — honour Retry-After, else exponential backoff.
      if (response.status === 429 && attempt < this.maxRetries) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000;
        await sleep(waitMs);
        lastError = new IntervalsApiError('intervals.icu rate limit (429)', 429, body);
        continue;
      }

      throw new IntervalsApiError(describeError(response.status, body), response.status, body);
    }

    throw lastError ?? new IntervalsApiError('intervals.icu request failed', 0, '');
  }

  /** Activities in a date window, inclusive. Dates are YYYY-MM-DD. */
  async getActivities(oldest: string, newest: string): Promise<IntervalsActivity[]> {
    const data = await this.request<IntervalsActivity[]>(
      `/athlete/${this.athleteId}/activities?oldest=${oldest}&newest=${newest}`,
    );
    return Array.isArray(data) ? data : [];
  }

  /** Laps for one activity. Returns [] when the activity has none. */
  async getActivityIntervals(activityId: string): Promise<IntervalsInterval[]> {
    const data = await this.request<IntervalsIntervalsResponse>(`/activity/${activityId}/intervals`);
    return Array.isArray(data?.icu_intervals) ? data.icu_intervals : [];
  }

  /**
   * HR + time streams for one activity.
   *
   * The response is an ARRAY of `{type, data}` — unlike Strava's
   * `key_by_type` object. Returns null when the activity carries no HR.
   */
  async getHrStream(activityId: string): Promise<{ hr: number[]; time: number[] | null } | null> {
    const streams = await this.request<IntervalsStream[]>(
      `/activity/${activityId}/streams?types=heartrate,time`,
    );
    if (!Array.isArray(streams)) return null;

    const hr = streams.find((s) => s.type === 'heartrate')?.data;
    if (!Array.isArray(hr) || hr.length === 0) return null;

    const time = streams.find((s) => s.type === 'time')?.data;
    return { hr, time: Array.isArray(time) ? time : null };
  }

  /**
   * Put a structured workout on the athlete's calendar.
   *
   * The event's `target` field is IGNORED by the workout parser — only the
   * suffix inside `description` decides how the numbers are read, and this app
   * always emits `% HR`, which resolves against MAX heart rate (probed
   * 2026-08-07; see lib/intervals/workout-format.ts).
   *
   * intervals.icu only pushes ~7 days ahead to the watch, so an event further
   * out lands on the calendar but will not reach the device until it is inside
   * that window.
   */
  async createWorkoutEvent(event: {
    startDateLocal: string;
    name: string;
    description: string;
    movingTimeSec?: number;
  }): Promise<{ id: number | string }> {
    return this.request(`/athlete/${this.athleteId}/events`, {
      method: 'POST',
      body: {
        category: 'WORKOUT',
        type: 'Run',
        start_date_local: event.startDateLocal,
        name: event.name,
        description: event.description,
        ...(event.movingTimeSec ? { moving_time: event.movingTimeSec } : {}),
      },
    });
  }

  /**
   * Calendar events in a date window, inclusive. Dates are YYYY-MM-DD.
   *
   * Read before every push so existing app-created events can be replaced
   * rather than duplicated.
   */
  async getEvents(oldest: string, newest: string): Promise<{ id: number | string; start_date_local?: string; description?: string | null }[]> {
    const data = await this.request<{ id: number | string; start_date_local?: string; description?: string | null }[]>(
      `/athlete/${this.athleteId}/events?oldest=${oldest}&newest=${newest}`,
    );
    return Array.isArray(data) ? data : [];
  }

  /** Remove a calendar event. Used to undo a push. */
  async deleteEvent(eventId: number | string): Promise<void> {
    await this.request(`/athlete/${this.athleteId}/events/${eventId}`, { method: 'DELETE' });
  }

  /**
   * The athlete's max HR as intervals.icu holds it, read from a recent
   * activity. Null when no activity in the window carries it.
   *
   * Used as the push-time gate: percentages resolve against THIS number, so
   * pushing while it disagrees with `athlete_profile.max_hr` would silently
   * send a different bpm range than the plan intends.
   */
  async getAthleteMaxHr(oldest: string, newest: string): Promise<number | null> {
    const activities = await this.getActivities(oldest, newest);
    const withMax = activities.find((a) => typeof a.athlete_max_hr === 'number');
    return withMax?.athlete_max_hr ?? null;
  }

  /** Daily wellness in a date window, inclusive. Dates are YYYY-MM-DD. */
  async getWellness(oldest: string, newest: string): Promise<IntervalsWellness[]> {
    const data = await this.request<IntervalsWellness[]>(
      `/athlete/${this.athleteId}/wellness?oldest=${oldest}&newest=${newest}`,
    );
    return Array.isArray(data) ? data : [];
  }
}

/**
 * Turn a status code into something that points at the actual cause. A bare
 * "403 Forbidden" sends people hunting for a permissions problem that is not
 * there.
 */
function describeError(status: number, body: string): string {
  const snippet = body.slice(0, 200);
  switch (status) {
    case 401:
      return `intervals.icu rejected the API key (401 "Auth failed"). Most often whitespace or quotes picked up while copying it; otherwise regenerate at intervals.icu/settings -> Developer Settings. ${snippet}`;
    case 403:
      // Two very different failures share this status, and blaming the
      // User-Agent for both sends people hunting a Cloudflare problem that
      // usually isn't there. Cloudflare serves an HTML challenge page; the
      // application serves clean JSON `{"status":403,"error":"Access denied"}`,
      // which means the athlete id is wrong (typically a missing "i" prefix).
      return /cloudflare/i.test(body)
        ? `intervals.icu returned 403 with a Cloudflare block page — the User-Agent is being rejected, not the key. ${snippet}`
        : `intervals.icu returned 403 "Access denied", which is an athlete-id problem rather than authentication — a wrong key gives 401. The id needs its "i" prefix (e.g. i665723), or leave it blank to use "0" (the authenticated athlete). ${snippet}`;
    case 404:
      return `intervals.icu returned 404 — check the athlete or activity id. ${snippet}`;
    case 429:
      return 'intervals.icu rate limit exceeded (429) and retries were exhausted.';
    default:
      return `intervals.icu API error ${status}: ${snippet}`;
  }
}

/**
 * Build a client from environment variables. Used by scripts (the Phase 7
 * backfill); request paths read credentials from `runcoach.intervals_tokens`
 * instead, where the key is encrypted at rest.
 */
export function intervalsClientFromEnv(): IntervalsClient {
  const apiKey = process.env.INTERVALS_API_KEY;
  if (!apiKey) {
    throw new Error('INTERVALS_API_KEY is not set — cannot reach intervals.icu.');
  }
  return new IntervalsClient({ apiKey, athleteId: process.env.INTERVALS_ATHLETE_ID });
}
