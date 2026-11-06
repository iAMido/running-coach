/**
 * Auto-sync of plan weeks to the watch: read its state, switch it on/off, or
 * run it now.
 *
 *   GET                       → { connected, autoPush, pushes: [...] }
 *   POST { autoPush: bool }   → switch (switching on runs it straight away)
 *   POST { run: true }        → run now
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { supabase } from '@/lib/db/supabase';
import { getActivePlan } from '@/lib/db/plans';
import { autoSyncPlanToWatch } from '@/lib/intervals/auto-sync';

export async function GET() {
  const auth = await getAuthenticatedUser();
  if (!auth.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: token } = await supabase.from('intervals_tokens').select('auto_push').eq('user_id', auth.userId).maybeSingle();
  if (!token) return NextResponse.json({ connected: false, autoPush: false, pushes: [] });
  const plan = await getActivePlan(auth.userId);
  const { data: pushes } = plan
    ? await supabase.from('watch_pushes').select('week_number,pushed_at,created,errors,trigger,content_hash')
      .eq('user_id', auth.userId).eq('plan_id', plan.id).order('week_number')
    : { data: [] };
  return NextResponse.json({ connected: true, autoPush: (token as { auto_push: boolean }).auto_push, pushes: pushes ?? [] });
}

const bodySchema = z.object({ autoPush: z.boolean().optional(), run: z.boolean().optional() });

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (!auth.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'Expected { autoPush } or { run }' }, { status: 400 });
  if (typeof parsed.data.autoPush === 'boolean') {
    await supabase.from('intervals_tokens').update({ auto_push: parsed.data.autoPush }).eq('user_id', auth.userId);
    if (!parsed.data.autoPush) return NextResponse.json({ autoPush: false });
  }
  const result = await autoSyncPlanToWatch(auth.userId, parsed.data.run ? 'manual' : 'switched_on');
  return NextResponse.json({ autoPush: true, result });
}
