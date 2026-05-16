import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

// Use service role key, fall back to anon key only during build (no env vars available)
const effectiveKey = supabaseServiceKey || supabaseAnonKey;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase: SupabaseClient<any> = createClient(
  supabaseUrl,
  effectiveKey,
  {
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
export function createServerClient(): SupabaseClient<any> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('Missing Supabase server credentials');
  }
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

// Client-side public client (very limited access due to RLS)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createPublicClient(): SupabaseClient<any> {
  return createClient(supabaseUrl, supabaseAnonKey);
}
