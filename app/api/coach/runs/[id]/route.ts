/**
 * PATCH a run's data by hand — the treadmill case. See lib/utils/treadmill.ts.
 *
 *   { action: 'edit', is_treadmill, distance_km?, duration_min?, elevation_gain_m?, incline? }
 *   { action: 'restore' }   → put the watch's values back
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabase } from '@/lib/db/supabase';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { buildRunEdit, buildRunRestore } from '@/lib/utils/treadmill';

const editSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('edit'),
    is_treadmill: z.boolean(),
    distance_km: z.number().positive().max(150).optional(),
    duration_min: z.number().positive().max(1440).optional(),
    elevation_gain_m: z.number().min(0).max(10000).optional(),
    incline: z.object({
      grade_pct: z.number().min(0).max(40),
      speed_kmh: z.number().positive().max(30),
      minutes: z.number().positive().max(600),
    }).optional(),
  }),
  z.object({ action: z.literal('restore') }),
]);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'Invalid run id' }, { status: 400 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = editSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  // Scoped to the athlete: the service role bypasses RLS, so the user filter
  // is what stops one account editing another's run.
  const { data: run, error: readError } = await supabase.from('runs').select('*').eq('id', id).eq('user_id', auth.userId).maybeSingle();
  if (readError) return NextResponse.json({ error: 'Could not read the run' }, { status: 500 });
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  let patch: Record<string, unknown> | null;
  try {
    patch = parsed.data.action === 'restore' ? buildRunRestore(run) : buildRunEdit(run, parsed.data);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Invalid values' }, { status: 400 });
  }
  if (!patch) return NextResponse.json({ error: 'This run has no manual edit to undo' }, { status: 400 });

  const { data: updated, error } = await supabase.from('runs').update(patch).eq('id', id).eq('user_id', auth.userId).select('*').single();
  if (error) return NextResponse.json({ error: 'Could not save the run' }, { status: 500 });
  return NextResponse.json({ run: updated });
}
