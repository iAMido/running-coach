/**
 * The season layer: read the active macro plan, or generate a new one.
 *
 * Generation is a single Opus call producing ~1.5k tokens of phase structure —
 * cheap next to a block, and rare (once per season, plus revisions).
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse, after } from 'next/server';
import { callOpenRouter } from '@/lib/ai/openrouter';
import { COACH_STATIC_BLOCK } from '@/lib/ai/coach-prompts';
import { buildMacroPlanPrompt } from '@/lib/ai/macro-plan-prompt';
import { getActiveMacroPlan, saveMacroPlan, type MacroPhase } from '@/lib/coach/macro-plan';
import { buildTrainingState } from '@/lib/coach/training-state';
import { getAthleteProfile } from '@/lib/db/profile';
import { getClimbBaseline } from '@/lib/db/runs';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { macroPlanGenerationSchema, validateInput } from '@/lib/validation/schemas';
import { logCoachCall } from '@/lib/supervisor';
import { MODEL_FOR } from '@/lib/ai/model-registry';

export async function GET() {
  const auth = await getAuthenticatedUser();
  if (!auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ macroPlan: await getActiveMacroPlan(auth.userId) });
}

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (!auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  const userId = auth.userId;

  const validation = validateInput(macroPlanGenerationSchema, await request.json());
  if (!validation.success) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const {
    goalName, raceDate, horizonWeeks, runsPerWeek,
    raceDistanceKm, raceElevationGainM, terrainAccess,
  } = validation.data;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'OPENROUTER_API_KEY not configured' }, { status: 500 });

  const profile = await getAthleteProfile(userId);
  const [state, climb] = await Promise.all([
    // No active plan is threaded in on purpose: the season is being designed,
    // so the current block should not colour its phase structure.
    buildTrainingState(userId, { profile, plan: null }).catch(() => null),
    raceElevationGainM ? getClimbBaseline(userId) : Promise.resolve(undefined),
  ]);

  const prompt = buildMacroPlanPrompt({
    goalName,
    raceDate,
    horizonWeeks,
    runsPerWeek,
    trainingDays: profile?.training_days || undefined,
    raceDemand: { distanceKm: raceDistanceKm, elevationGainM: raceElevationGainM, terrainAccess, climb },
    state,
  });

  const started = Date.now();
  const response = await callOpenRouter(
    [
      { role: 'system', content: prompt },
      { role: 'user', content: 'Design my season. Return ONLY the raw JSON object.' },
    ],
    { apiKey, model: MODEL_FOR.plan_generation, maxTokens: 6000, cacheableSystemPrefix: COACH_STATIC_BLOCK },
  );
  const latencyMs = Date.now() - started;

  if (response.error) return NextResponse.json({ error: response.error }, { status: 500 });

  let parsed: { goal_name?: string; rationale?: string; phases?: MacroPhase[] };
  try {
    const fenced = response.content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    const first = response.content.indexOf('{');
    const last = response.content.lastIndexOf('}');
    parsed = fenced
      ? JSON.parse(fenced[1])
      : JSON.parse(response.content.slice(first, last + 1));
  } catch {
    return NextResponse.json(
      { error: 'Could not parse the season plan as JSON.', raw: response.content.slice(0, 2000) },
      { status: 502 },
    );
  }

  if (!Array.isArray(parsed.phases) || parsed.phases.length === 0) {
    return NextResponse.json({ error: 'The model returned no phases.' }, { status: 502 });
  }

  const saved = await saveMacroPlan(userId, {
    goal_name: parsed.goal_name || goalName,
    race_date: raceDate ?? null,
    race_distance_km: raceDistanceKm ?? null,
    race_elevation_gain_m: raceElevationGainM ?? null,
    terrain_access: terrainAccess ?? null,
    horizon_weeks: horizonWeeks,
    phases: parsed.phases,
    rationale: parsed.rationale ?? null,
  });

  if (!saved) return NextResponse.json({ error: 'Failed to save the season plan.' }, { status: 500 });

  // Telemetry off the critical path, matching every other AI route here.
  after(async () => {
    await logCoachCall({
      user_id: userId,
      route: '/api/coach/macro-plan',
      query_type: 'plan_generation',
      model: MODEL_FOR.plan_generation,
      context_tokens: null,
      context_budget: null,
      ceiling_hit: false,
      cache_used: true,
      preflight_ok: true,
      preflight_warnings: null,
      preflight_augmented: false,
      latency_ms: latencyMs,
      status: 'ok',
      error_message: null,
      plan_modified: true,
    }).catch(() => {});
  });

  return NextResponse.json({ macroPlan: saved });
}
