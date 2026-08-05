/**
 * Encryption for the intervals.icu API key.
 *
 * The key grants **write** access to the athlete's training calendar — it can
 * create and delete workouts on their watch — so it must not sit in the
 * database as plaintext.
 *
 * RLS does not protect it. `lib/db/supabase.ts` connects with the service-role
 * key, which bypasses RLS by design, so anyone holding that key reads every
 * row regardless of policy. pgcrypto would not help either: if the decryption
 * key is reachable from the database, compromising the database still yields
 * the credential.
 *
 * So the secret lives outside Postgres, in `INTERVALS_TOKEN_KEY`. Reading the
 * database is then not sufficient to use the credential — an attacker needs
 * the application environment too.
 *
 * AES-256-GCM is authenticated: tampering with the stored blob fails the tag
 * check and throws rather than silently returning corrupted plaintext.
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'crypto';

const KEY_ENV = 'INTERVALS_TOKEN_KEY';
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12; // 96-bit nonce, the GCM standard
/** Version prefix so the format can change without ambiguity about old rows. */
const VERSION = 'v1';

/**
 * Accepts base64 or hex; both are common ways to paste 32 random bytes into an
 * env file. Anything that does not decode to exactly 32 bytes is rejected
 * loudly — a short key would otherwise silently weaken every stored secret.
 */
function loadKey(): Buffer {
  const raw = process.env[KEY_ENV];
  if (!raw) {
    throw new Error(
      `${KEY_ENV} is not set. Generate one with:  openssl rand -base64 32\n` +
        `Refusing to handle the intervals.icu API key without it.`,
    );
  }

  const trimmed = raw.trim();
  const candidates = [
    /^[0-9a-fA-F]+$/.test(trimmed) ? Buffer.from(trimmed, 'hex') : null,
    Buffer.from(trimmed, 'base64'),
  ];

  const key = candidates.find((b) => b && b.length === KEY_BYTES);
  if (!key) {
    throw new Error(
      `${KEY_ENV} must decode to ${KEY_BYTES} bytes (got a value that does not). ` +
        `Generate one with:  openssl rand -base64 32`,
    );
  }
  return key;
}

/**
 * True when a usable key is configured. Lets a route return a clean 500 with a
 * useful message instead of throwing deep inside a request.
 */
export function isEncryptionConfigured(): boolean {
  try {
    loadKey();
    return true;
  } catch {
    return false;
  }
}

/** Encrypt a secret for storage. Output: `v1.<iv>.<tag>.<ciphertext>`, base64url. */
export function encryptSecret(plaintext: string): string {
  if (!plaintext) throw new Error('Refusing to encrypt an empty secret');

  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

/** Reverse of `encryptSecret`. Throws if the blob was tampered with. */
export function decryptSecret(payload: string): string {
  const parts = payload?.split('.') ?? [];
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error(`Unrecognised secret format — expected "${VERSION}.iv.tag.ciphertext"`);
  }

  const [, ivB64, tagB64, ctB64] = parts;
  const key = loadKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));

  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]).toString('utf8');
}

/**
 * Distinguishes an already-encrypted value from a plaintext one, so a caller
 * can avoid double-encrypting on update without attempting a decrypt.
 */
export function looksEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(`${VERSION}.`) && value.split('.').length === 4;
}

/**
 * Constant-time compare for webhook shared secrets (phase 5). Lives here so
 * every secret comparison in the intervals path uses the same primitive.
 */
export function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a ?? '', 'utf8');
  const bufB = Buffer.from(b ?? '', 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
