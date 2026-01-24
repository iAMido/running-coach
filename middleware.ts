import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Simple in-memory rate limit store for edge runtime
// Note: This resets on deployment and isn't shared across instances
// For production, consider using Vercel KV or Upstash Redis
const rateLimit = new Map<string, { count: number; resetTime: number }>();

// Rate limit configurations by route pattern
const RATE_LIMITS: Record<string, { maxRequests: number; windowMs: number }> = {
  // AI routes - expensive operations
  '/api/coach/chat': { maxRequests: 20, windowMs: 60000 },
  '/api/coach/plans/generate': { maxRequests: 10, windowMs: 60000 },
  '/api/coach/plans/adjust': { maxRequests: 10, windowMs: 60000 },
  '/api/coach/review/analyze': { maxRequests: 10, windowMs: 60000 },

  // Auth routes - prevent brute force
  '/api/auth': { maxRequests: 20, windowMs: 60000 },
  '/api/strava/auth': { maxRequests: 10, windowMs: 60000 },

  // Default for other API routes
  'default': { maxRequests: 100, windowMs: 60000 },
};

function getClientIdentifier(request: NextRequest): string {
  // Try X-Forwarded-For first (behind proxy/load balancer)
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  // Try X-Real-IP
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }

  // Fallback
  return 'unknown';
}

function getRateLimitConfig(pathname: string): { maxRequests: number; windowMs: number } {
  // Check for specific route patterns
  for (const [pattern, config] of Object.entries(RATE_LIMITS)) {
    if (pattern !== 'default' && pathname.startsWith(pattern)) {
      return config;
    }
  }
  return RATE_LIMITS.default;
}

function checkRateLimit(
  identifier: string,
  pathname: string
): { allowed: boolean; remaining: number; retryAfter?: number } {
  const config = getRateLimitConfig(pathname);
  const key = `${identifier}:${pathname.split('/').slice(0, 4).join('/')}`;
  const now = Date.now();

  const entry = rateLimit.get(key);

  // Clean expired entries
  if (entry && entry.resetTime < now) {
    rateLimit.delete(key);
  }

  const currentEntry = rateLimit.get(key);

  if (!currentEntry) {
    rateLimit.set(key, { count: 1, resetTime: now + config.windowMs });
    return { allowed: true, remaining: config.maxRequests - 1 };
  }

  currentEntry.count++;

  if (currentEntry.count > config.maxRequests) {
    const retryAfter = Math.ceil((currentEntry.resetTime - now) / 1000);
    return { allowed: false, remaining: 0, retryAfter };
  }

  return { allowed: true, remaining: config.maxRequests - currentEntry.count };
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only rate limit API routes
  if (!pathname.startsWith('/api')) {
    return NextResponse.next();
  }

  // Skip rate limiting for NextAuth callback routes
  if (pathname.includes('/api/auth/callback')) {
    return NextResponse.next();
  }

  const clientId = getClientIdentifier(request);
  const result = checkRateLimit(clientId, pathname);

  if (!result.allowed) {
    return new NextResponse(
      JSON.stringify({
        error: 'Too many requests',
        retryAfter: result.retryAfter
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(result.retryAfter || 60),
          'X-RateLimit-Remaining': '0',
        },
      }
    );
  }

  // Add rate limit headers to successful responses
  const response = NextResponse.next();
  response.headers.set('X-RateLimit-Remaining', String(result.remaining));

  return response;
}

// Configure which routes the middleware runs on
export const config = {
  matcher: [
    // Match all API routes except static files
    '/api/:path*',
  ],
};
