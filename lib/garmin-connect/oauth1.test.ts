/** Run with `bun test`. Pinned to the worked example in RFC 5849 §3.4.1 / the Twitter docs example. */

import { expect, test } from 'bun:test';
import { oauth1Header, percentEncode, signatureBaseString } from '@/lib/garmin-connect/oauth1';

test('percent-encoding follows RFC 3986', () => {
  expect(percentEncode("Ladies + Gentlemen!*'()")).toBe('Ladies%20%2B%20Gentlemen%21%2A%27%28%29');
  expect(percentEncode('a-b_c.d~e')).toBe('a-b_c.d~e');
});

// The widely used Twitter worked example (dev.twitter.com "Creating a signature").
const example = {
  consumerKey: 'xvz1evFS4wEEPTGEFPHBog',
  consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
  token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
  tokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
};

test('signs the reference request exactly', () => {
  const header = oauth1Header(example, {
    method: 'POST',
    url: 'https://api.twitter.com/1.1/statuses/update.json?include_entities=true',
    form: { status: 'Hello Ladies + Gentlemen, a signed OAuth request!' },
    nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
    timestamp: '1318622958',
  });
  expect(header).toContain('oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"');
});

test('query parameters are part of the base string', () => {
  const base = signatureBaseString('GET', 'https://x.test/a?b=2&a=1', [['oauth_nonce', 'n']]);
  expect(base).toBe('GET&https%3A%2F%2Fx.test%2Fa&a%3D1%26b%3D2%26oauth_nonce%3Dn');
});
