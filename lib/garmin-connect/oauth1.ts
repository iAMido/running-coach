/**
 * OAuth 1.0a request signing (HMAC-SHA1, RFC 5849), as Garmin Connect's
 * token service expects it. Used for two calls only: turning a login ticket
 * into an OAuth1 token, and turning that OAuth1 token into a day-long OAuth2
 * token. Every data call afterwards is a plain `Bearer` request.
 */

import { createHmac, randomBytes } from 'node:crypto';

/** RFC 3986 percent-encoding (encodeURIComponent leaves !'()* alone). */
export function percentEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export interface OAuth1Credentials {
  consumerKey: string;
  consumerSecret: string;
  token?: string;
  tokenSecret?: string;
}

export interface SignOptions {
  method: string;
  url: string;
  /** Form-encoded body parameters, which are part of the signature. */
  form?: Record<string, string>;
  /** Injectable for tests. */
  nonce?: string;
  timestamp?: string;
}

/** The signature base string: METHOD&url&sorted-params, each part encoded. */
export function signatureBaseString(method: string, url: string, params: [string, string][]): string {
  const u = new URL(url);
  const base = `${u.protocol}//${u.host}${u.pathname}`;
  const all: [string, string][] = [...params];
  u.searchParams.forEach((v, k) => all.push([k, v]));
  const normalized = all
    .map(([k, v]) => [percentEncode(k), percentEncode(v)] as [string, string])
    .sort(([ak, av], [bk, bv]) => (ak === bk ? (av < bv ? -1 : av > bv ? 1 : 0) : ak < bk ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return [method.toUpperCase(), percentEncode(base), percentEncode(normalized)].join('&');
}

/** The `Authorization: OAuth …` header for one request. */
export function oauth1Header(creds: OAuth1Credentials, opts: SignOptions): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: opts.nonce ?? randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: opts.timestamp ?? String(Math.floor(Date.now() / 1000)),
    oauth_version: '1.0',
  };
  if (creds.token) oauth.oauth_token = creds.token;

  const params: [string, string][] = [...Object.entries(oauth), ...Object.entries(opts.form ?? {})];
  const base = signatureBaseString(opts.method, opts.url, params);
  const key = `${percentEncode(creds.consumerSecret)}&${percentEncode(creds.tokenSecret ?? '')}`;
  oauth.oauth_signature = createHmac('sha1', key).update(base).digest('base64');

  return 'OAuth ' + Object.entries(oauth).map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`).join(', ');
}
