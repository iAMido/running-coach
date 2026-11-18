import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

/**
 * No service key outside the build = misconfigured, and it must be loud.
 *
 * This used to fall back to the anon key everywhere, not only during the build
 * it was meant for. RLS blocks the anon role from every runcoach table, so
 * each query then returned EMPTY rather than failing: the dashboard showed no
 * runs, the coach saw no history, and nothing said why. Now, at runtime, every
 * query errors with the reason. The build (static analysis, no env vars) still
 * gets the placeholder client it needs.
 */
const isBuild = process.env.NEXT_PHASE === 'phase-production-build';
export const MISSING_SERVICE_KEY = 'SUPABASE_SERVICE_ROLE_KEY is not set: RunCoach database calls are disabled';
const effectiveKey = supabaseServiceKey || supabaseAnonKey;
const missingKeyFetch: typeof fetch = async () => {
  throw new Error(MISSING_SERVICE_KEY);
};
if (!supabaseServiceKey && !isBuild) console.error(MISSING_SERVICE_KEY);

// RunCoach data now lives in the `runcoach` schema of the CalTrack Supabase
// project. The Supabase JS client routes every `.from(...)` call through
// the schema configured here, so no callsite edits are needed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase: SupabaseClient<any, any, any> = createClient(
  supabaseUrl,
  effectiveKey,
  {
    db: { schema: 'runcoach' },
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    ...(!supabaseServiceKey && !isBuild ? { global: { fetch: missingKeyFetch } } : {}),
  }
);

// Check if Supabase is properly configured
export function isSupabaseConfigured(): boolean {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_URL !== undefined &&
    process.env.SUPABASE_SERVICE_ROLE_KEY !== undefined
  );
}

// Explicit server client creation (for scripts/migrations)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createServerClient(): SupabaseClient<any, any, any> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('Missing Supabase server credentials');
  }
  return createClient(url, serviceRoleKey, {
    db: { schema: 'runcoach' },
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

// Client-side public client (very limited access due to RLS)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createPublicClient(): SupabaseClient<any, any, any> {
  return createClient(supabaseUrl, supabaseAnonKey, {
    db: { schema: 'runcoach' },
  });
}
