/**
 * Staged plan builder API. See lib/coach/plan-builder/runner.ts.
 *
 *   POST { ...plan request }  → start a build and run its first stage
 *   POST { buildId }          → run the build's next stage
 *   GET  ?id=<buildId>        → a build's current state
 *   GET                       → the athlete's unfinished build, if any (resume)
 *
 * The client calls POST { buildId } until `stage` is done or failed. One
 * stage per request keeps every request well inside the function limit.
 */

export const runtime = 'nodejs';
// The head coach's stages (outline, review) run on a model whose thinking
// cannot be switched off. Stated explicitly rather than inherited.
export const maxDuration = 300;

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabase } from '@/lib/db/supabase';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { planGenerationSchema, validateInput } from '@/lib/validation/schemas';
import { advance, createBuild, getBuild, latestOpenBuild } from '@/lib/coach/plan-builder/runner';
import { toView } from '@/lib/coach/plan-builder/view';
import type { PlanBuildRow } from '@/lib/coach/plan-builder/types';

async function view(row: PlanBuildRow, busy = false) {
  let plan = null;
  if (row.stage === 'done' && row.plan_id) {
    const { data } = await supabase.from('training_plans').select('*').eq('id', row.plan_id).maybeSingle();
    plan = data;
  }
  return toView(row, busy, plan);
}

export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = request.nextUrl.searchParams.get('id');
  const row = id ? await getBuild(auth.userId, id) : await latestOpenBuild(auth.userId);
  return NextResponse.json({ build: row ? await view(row) : null });
}

const advanceSchema = z.object({ buildId: z.string().uuid() });

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!process.env.OPENROUTER_API_KEY) return NextResponse.json({ error: 'OpenRouter API key not configured' }, { status: 500 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  try {
    const next = advanceSchema.safeParse(body);
    if (next.success) {
      const { row, busy } = await advance(auth.userId, next.data.buildId);
      return NextResponse.json({ build: await view(row, busy) });
    }
    const validation = validateInput(planGenerationSchema, body);
    if (!validation.success) return NextResponse.json({ error: validation.error }, { status: 400 });
    const created = await createBuild(auth.userId, validation.data);
    const { row, busy } = await advance(auth.userId, created.id);
    return NextResponse.json({ build: await view(row, busy) });
  } catch (err) {
    console.error('plan build failed:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Plan build failed' }, { status: 500 });
  }
}
