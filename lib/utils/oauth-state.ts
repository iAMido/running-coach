/**
 * Secure OAuth State Management
 * Uses HMAC-SHA256 to sign state parameters to prevent CSRF attacks
 */

import { createHmac, randomBytes } from 'crypto';

const STATE_SEPARATOR = '.';
const STATE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

function getSecretKey(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error('NEXTAUTH_SECRET is required for OAuth state signing');
  }
  return secret;
}

function sign(data: string): string {
  const hmac = createHmac('sha256', getSecretKey());
  hmac.update(data);
  return hmac.digest('hex');
}

/**
 * Generate a signed OAuth state parameter
 * Format: base64(userId:timestamp:nonce).signature
 */
export function generateOAuthState(userId: string): string {
  const timestamp = Date.now().toString();
  const nonce = randomBytes(16).toString('hex');
  const payload = `${userId}:${timestamp}:${nonce}`;
  const encodedPayload = Buffer.from(payload).toString('base64url');
  const signature = sign(encodedPayload);
  return `${encodedPayload}${STATE_SEPARATOR}${signature}`;
}

/**
 * Verify and extract userId from a signed OAuth state parameter
 * Returns null if invalid or expired
 */
export function verifyOAuthState(state: string): { userId: string; valid: boolean; error?: string } {
  try {
    const parts = state.split(STATE_SEPARATOR);
    if (parts.length !== 2) {
      return { userId: '', valid: false, error: 'Invalid state format' };
    }

    const [encodedPayload, providedSignature] = parts;

    // Verify signature
    const expectedSignature = sign(encodedPayload);
    if (providedSignature !== expectedSignature) {
      return { userId: '', valid: false, error: 'Invalid state signature' };
    }

    // Decode payload
    const payload = Buffer.from(encodedPayload, 'base64url').toString();
    const [userId, timestamp] = payload.split(':');

    // Check expiry
    const stateTime = parseInt(timestamp, 10);
    if (Date.now() - stateTime > STATE_EXPIRY_MS) {
      return { userId: '', valid: false, error: 'State expired' };
    }

    return { userId, valid: true };
  } catch {
    return { userId: '', valid: false, error: 'Failed to parse state' };
  }
}
