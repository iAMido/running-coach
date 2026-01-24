/**
 * Simple in-memory rate limiter for API routes
 * For production with multiple instances, consider using Redis
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// In-memory store - cleared on server restart
const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetTime < now) {
      rateLimitStore.delete(key);
    }
  }
}, 60000); // Clean up every minute

export interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
}

/**
 * Check if a request should be rate limited
 * @param identifier - Unique identifier (usually IP or user ID)
 * @param config - Rate limit configuration
 * @returns Rate limit result with success status and remaining requests
 */
export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): RateLimitResult {
  const now = Date.now();
  const key = identifier;
  const entry = rateLimitStore.get(key);

  // If no entry or window expired, create new entry
  if (!entry || entry.resetTime < now) {
    rateLimitStore.set(key, {
      count: 1,
      resetTime: now + config.windowMs,
    });
    return {
      success: true,
      remaining: config.maxRequests - 1,
      resetTime: now + config.windowMs,
    };
  }

  // Increment count
  entry.count++;

  // Check if over limit
  if (entry.count > config.maxRequests) {
    return {
      success: false,
      remaining: 0,
      resetTime: entry.resetTime,
      retryAfter: Math.ceil((entry.resetTime - now) / 1000),
    };
  }

  return {
    success: true,
    remaining: config.maxRequests - entry.count,
    resetTime: entry.resetTime,
  };
}

// Preset configurations for different route types
export const RATE_LIMITS = {
  // Standard API routes - 100 requests per minute
  standard: { maxRequests: 100, windowMs: 60 * 1000 },

  // AI/expensive routes - 20 requests per minute
  ai: { maxRequests: 20, windowMs: 60 * 1000 },

  // Auth routes - 10 requests per minute
  auth: { maxRequests: 10, windowMs: 60 * 1000 },

  // Strict - for sensitive operations - 5 per minute
  strict: { maxRequests: 5, windowMs: 60 * 1000 },
} as const;

/**
 * Get client identifier from request headers
 * Prefers X-Forwarded-For for proxied requests, falls back to a default
 */
export function getClientIdentifier(headers: Headers): string {
  // Try X-Forwarded-For first (common behind proxies)
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  // Try X-Real-IP
  const realIp = headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }

  // Fallback to a generic identifier
  return 'unknown-client';
}
