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

  // Try a simple query
  let queryResult: unknown;
  try {
    const { data, error, status, statusText } = await supabase
      .from('runs')
      .select('id', { count: 'exact', head: true });
    queryResult = { data, error, status, statusText };
  } catch (e) {
    queryResult = { caught: (e as Error).message };
  }

  return NextResponse.json({ env, queryResult }, { status: 200 });
}
