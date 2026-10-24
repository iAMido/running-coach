/** Run with `bun test`. */
import { expect, test } from 'bun:test';
import { GarminClient, GarminApiError, GarminRateLimitedError, parseTokenBody } from './client';

type Call = { url: string; headers: Record<string, string>; method: string };

function fakeFetch(responses: Array<{ status: number; body?: string; headers?: Record<string, string> }>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string>, method: init?.method ?? 'GET' });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request ${url}`);
    return new Response(next.body ?? '', { status: next.status, headers: next.headers });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test('token exchange sends ApiKey and NO Accept header (Accept: application/json gets a 406)', async () => {
  const { impl, calls } = fakeFetch([{ status: 200, body: 'tok-1' }, { status: 200, body: '{"hrvSummaries":[]}' }]);
  const client = new GarminClient({ apiKey: 'key', fetchImpl: impl });
  await client.getHrvRange('2026-10-01', '2026-10-23');
  expect(calls[0].method).toBe('POST');
  expect(calls[0].headers.Authorization).toBe('ApiKey key');
  expect('Accept' in calls[0].headers).toBe(false);
  expect(calls[1].headers.Authorization).toBe('Bearer tok-1');
});

test('a cached, unexpired token is reused — no exchange', async () => {
  const { impl, calls } = fakeFetch([{ status: 200, body: '{"data":[]}' }]);
  const client = new GarminClient({
    apiKey: 'key',
    fetchImpl: impl,
    cachedToken: { token: 'cached', expiresAt: new Date(Date.now() + 3_600_000) },
  });
  await client.getDailySummaries('2026-10-01', '2026-10-23');
  expect(calls).toHaveLength(1);
  expect(calls[0].headers.Authorization).toBe('Bearer cached');
});

test('a 401 on a cached token re-exchanges exactly once, and persists the new token', async () => {
  const saved: string[] = [];
  const { impl, calls } = fakeFetch([
    { status: 401 },
    { status: 200, body: 'fresh' },
    { status: 200, body: '[]' },
  ]);
  const client = new GarminClient({
    apiKey: 'key',
    fetchImpl: impl,
    cachedToken: { token: 'revoked', expiresAt: new Date(Date.now() + 3_600_000) },
    onToken: (t) => {
      saved.push(t.token);
    },
  });
  await client.getBodyBatteryReports('2026-10-01', '2026-10-23');
  expect(calls).toHaveLength(3);
  expect(saved).toEqual(['fresh']);
});

test('a second 401 is a real credential failure, not a loop', async () => {
  const { impl } = fakeFetch([{ status: 200, body: 't1' }, { status: 401 }, { status: 200, body: 't2' }, { status: 401 }]);
  const client = new GarminClient({ apiKey: 'key', fetchImpl: impl });
  await expect(client.getHrvRange('2026-10-01', '2026-10-23')).rejects.toBeInstanceOf(GarminApiError);
});

test('429 throws GarminRateLimitedError with Retry-After, and the error never carries the query', async () => {
  const { impl } = fakeFetch([{ status: 200, body: 't' }, { status: 429, headers: { 'retry-after': '120' } }]);
  const client = new GarminClient({ apiKey: 'key', fetchImpl: impl });
  const err = await client.getDailySummaries('2026-10-01', '2026-10-23').catch((e) => e);
  expect(err).toBeInstanceOf(GarminRateLimitedError);
  expect(err.retryAfterSec).toBe(120);
  expect(err.path).toBe('/usersummary-service/v2/dailysummaries');
});

test('an empty body (nothing recorded that night) is null, not a parse error', async () => {
  const { impl } = fakeFetch([{ status: 200, body: 't' }, { status: 200, body: '' }]);
  const client = new GarminClient({ apiKey: 'key', fetchImpl: impl });
  expect(await client.getDailySleep('2026-10-23')).toBeNull();
});

test('token body: raw string, quoted string, or JSON wrapper', () => {
  expect(parseTokenBody('  abc  ')).toBe('abc');
  expect(parseTokenBody('"abc"')).toBe('abc');
  expect(parseTokenBody('{"access_token":"abc"}')).toBe('abc');
  expect(() => parseTokenBody('   ')).toThrow();
});
