/**
 * Training races and events: list (with results matched to runs) and add.
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { createEvent, listEvents, syncEventResults } from '@/lib/db/season-events';
import { seasonEventSchema, validateInput } from '@/lib/validation/schemas';
import { supabase } from '@/lib/db/supabase';

export async function GET() {
  const auth = await getAuthenticatedUser();
  if (!auth.userId) return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  const events = await syncEventResults(auth.userId, await listEvents(auth.userId));
  // The matched run, so the page can show the result without a second request.
  const runIds = events.map((e) => e.run_id).filter((x): x is string => !!x);
  const { data: runs } = runIds.length
    ? await supabase.from('runs').select('id,date,distance_km,duration_min,avg_pace_str,elevation_gain_m,avg_hr').in('id', runIds)
    : { data: [] };
  return NextResponse.json({ events, runs: runs ?? [] });
}

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (!auth.userId) return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  const v = validateInput(seasonEventSchema, await request.json().catch(() => ({})));
  if (!v.success) return NextResponse.json({ error: v.error }, { status: 400 });
  if (!v.data.name || !v.data.event_date) return NextResponse.json({ error: 'An event needs a name and a date.' }, { status: 400 });
  try {
    return NextResponse.json({ event: await createEvent(auth.userId, v.data) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not add the event' }, { status: 500 });
  }
}
