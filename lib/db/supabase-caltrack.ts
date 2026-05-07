import { createClient, SupabaseClient } from '@supabase/supabase-js';

const caltrackUrl = process.env.CALTRACK_SUPABASE_URL || '';
const caltrackServiceKey = process.env.CALTRACK_SUPABASE_SERVICE_ROLE_KEY || '';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const caltrackDb: SupabaseClient<any> = createClient(
  caltrackUrl || 'https://placeholder.supabase.co',
  caltrackServiceKey || 'placeholder-key',
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

export function isCaltrackConfigured(): boolean {
  return Boolean(
    process.env.CALTRACK_SUPABASE_URL &&
    process.env.CALTRACK_SUPABASE_SERVICE_ROLE_KEY
  );
}
