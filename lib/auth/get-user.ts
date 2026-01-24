/**
 * Secure user authentication helper for API routes
 * Centralizes authentication logic and eliminates DEV_USER_ID bypass vulnerabilities
 */

import { getServerSession } from 'next-auth';

export interface AuthResult {
  authenticated: boolean;
  userId: string | null;
  error?: string;
}

/**
 * Get authenticated user ID from session
 * Returns null if not authenticated - no bypass for development
 */
export async function getAuthenticatedUser(): Promise<AuthResult> {
  try {
    const session = await getServerSession();

    if (!session?.user?.email) {
      return {
        authenticated: false,
        userId: null,
        error: 'Authentication required',
      };
    }

    return {
      authenticated: true,
      userId: session.user.email,
    };
  } catch (error) {
    console.error('Authentication error:', error);
    return {
      authenticated: false,
      userId: null,
      error: 'Authentication failed',
    };
  }
}

/**
 * Require authentication - throws if not authenticated
 * Use in API routes that must have a valid user
 */
export async function requireAuth(): Promise<string> {
  const result = await getAuthenticatedUser();
  if (!result.authenticated || !result.userId) {
    throw new Error(result.error || 'Unauthorized');
  }
  return result.userId;
}
