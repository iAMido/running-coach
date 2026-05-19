import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

// Use service role key, fall back to anon key only during build (no env vars available)
const effectiveKey = supabaseServiceKey || supabaseAnonKey;

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
    }
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
