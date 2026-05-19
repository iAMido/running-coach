// TEMPORARY DIAGNOSTIC ENDPOINT — remove after migration verification.
// Returns enough info to diagnose why the runcoach schema queries fail,
// WITHOUT leaking secrets.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  // Decode the project ref from each JWT (middle segment, base64url-encoded JSON)
  function jwtRef(jwt: string): string {
    try {
      const parts = jwt.split('.');
      if (parts.length !== 3) return '(not a JWT)';
      const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = payloadB64 + '='.repeat((4 - payloadB64.length % 4) % 4);
      const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf-8'));
      return `ref=${payload.ref || '?'} role=${payload.role || '?'}`;
    } catch {
      return '(decode failed)';
    }
  }

  const env = {
    NEXT_PUBLIC_SUPABASE_URL: url,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey ? jwtRef(serviceKey) : '(empty)',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey ? jwtRef(anonKey) : '(empty)',
    CALTRACK_SUPABASE_URL: process.env.CALTRACK_SUPABASE_URL || '(empty)',
    CALTRACK_SUPABASE_SERVICE_ROLE_KEY: process.env.CALTRACK_SUPABASE_SERVICE_ROLE_KEY
      ? jwtRef(process.env.CALTRACK_SUPABASE_SERVICE_ROLE_KEY)
      : '(empty)',
  };

  // Try real queries against multiple tables
  const checks: Record<string, unknown> = {};
  try {
    const r = await supabase.from('runs').select('id, date', { count: 'exact' }).order('date', { ascending: false }).limit(1);
    checks.runs = { count: r.count, newest: r.data?.[0]?.date, error: r.error?.message };
  } catch (e) { checks.runs = { caught: (e as Error).message }; }
  try {
    const r = await supabase.from('athlete_profile').select('name, age', { count: 'exact' });
    checks.athlete_profile = { count: r.count, name: r.data?.[0]?.name, error: r.error?.message };
  } catch (e) { checks.athlete_profile = { caught: (e as Error).message }; }
  try {
    const r = await supabase.from('book_instructions').select('id', { count: 'exact', head: true });
    checks.book_instructions = { count: r.count, error: r.error?.message };
  } catch (e) { checks.book_instructions = { caught: (e as Error).message }; }
  try {
    const r = await supabase.from('strava_tokens').select('user_id', { count: 'exact' });
    checks.strava_tokens = { count: r.count, error: r.error?.message };
  } catch (e) { checks.strava_tokens = { caught: (e as Error).message }; }

  return NextResponse.json({ env, checks }, { status: 200 });
}
