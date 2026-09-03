export const runtime = 'nodejs';

import { NextRequest, NextResponse, after } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { callOpenRouter } from '@/lib/ai/openrouter';
import { buildEnhancedPlanGenerationPrompt, COACH_STATIC_BLOCK } from '@/lib/ai/coach-prompts';
import { buildContext, getContextStats } from '@/lib/rag/context-builder';
import { getAthleteProfile } from '@/lib/db/profile';
import { getClimbBaseline } from '@/lib/db/runs';
import { getActiveMacroPlan, phaseForWeek, formatMacroPlan } from '@/lib/coach/macro-plan';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { planGenerationSchema, validateInput } from '@/lib/validation/schemas';
import {
  validateContext as supervisorValidate,
  serializeWarnings,
  logCoachCall,
  runCritic,
} from '@/lib/supervisor';
import { TOKEN_BUDGETS_PER_QUERY } from '@/lib/rag/types';
import { MODEL_FOR } from '@/lib/ai/model-registry';
import { buildPlanGenerationContext } from '@/lib/rag/plan-generation-context';

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const userId = auth.userId;
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: 'OpenRouter API key not configured' }, { status: 500 });
  }

  try {
    const body = await request.json();

    // Validate input
    const validation = validateInput(planGenerationSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const {
      planType, durationWeeks, runsPerWeek, targetRace, notes,
      trainingDays: requestedDays, trainingDayNotes,
      macroPlanId, blockNumber,
      raceDistanceKm, raceElevationGainM, terrainAccess,
      raceDate, targetTime, recentRaceResult, currentWeeklyKm, addressesWhat, limitations,
    } = validation.data;

    // Build a query string for context retrieval
    const contextQuery = `Create a ${durationWeeks}-week ${planType} training plan for ${targetRace || 'general fitness'}`;

    // Profile fetched once here and threaded into buildContext (was fetched
    // again inside the user-formatter). The 3-layer context and the intake
    // block are independent — run all three together.
    const profile = await getAthleteProfile(userId);
    const [context, planGenCtx] = await Promise.all([
      buildContext(userId, contextQuery, 'plan_generation', { profile }),
      buildPlanGenerationContext(userId, {
        raceDate, targetTime, recentRaceResult, currentWeeklyKm, addressesWhat, limitations,
      }),
    ]);

    // His own measured climbing, fetched ONLY when the race actually has an
    // elevation target - a road plan pays nothing for this. Without it the
    // model has no anchor for a vert ramp and invents one.
    const climbBaseline = raceElevationGainM
      ? await getClimbBaseline(userId)
      : undefined;

      const macroContext = await resolveMacroContext(userId, macroPlanId, blockNumber);


    // Pre-flight supervisor gate for plan generation. Flags zero book
    // sources or zero coach workouts surfaced — both mean the resulting
    // plan will lean entirely on the model's priors.
    const preflight = supervisorValidate({ context, queryType: 'plan_generation' });

    // Build enhanced plan generation prompt with 3-layer context + intake block
    let systemPrompt = buildEnhancedPlanGenerationPrompt(context, {
      planType,
      durationWeeks,
      runsPerWeek,
      targetRace,
      notes,
      trainingDays: resolveTrainingDays(requestedDays, profile?.training_days, trainingDayNotes),
      // Race profile + his OWN measured climbing. Without the second
      // half the model has no anchor and invents a starting point.
      macroContext: macroContext.text,
      raceDemand: {
        distanceKm: raceDistanceKm,
        elevationGainM: raceElevationGainM,
        terrainAccess,
        climb: climbBaseline,
      },
      intakeBlock: planGenCtx.intakeBlock,
    });
    if (preflight.augmentedSystemSuffix) {
      systemPrompt = systemPrompt + preflight.augmentedSystemSuffix;
    }

    // Static persona block travels as cacheableSystemPrefix so plan-gen
    // retries within 5 minutes hit the Anthropic prompt cache.
    const callStart = Date.now();
    const response = await callOpenRouter(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Generate my ${durationWeeks}-week ${planType} training plan. IMPORTANT: Return ONLY the raw JSON object with no markdown code blocks, no explanation, no extra text — just the JSON.` },
      ],
      { apiKey, model: MODEL_FOR.plan_generation, maxTokens: 16000, cacheableSystemPrefix: COACH_STATIC_BLOCK }
    );
    const callLatencyMs = Date.now() - callStart;

    if (response.error) {
      return NextResponse.json({ error: response.error }, { status: 500 });
    }

    // Try to parse JSON from response
    let planJson;
    try {
      // First: try to extract JSON from a markdown code block (```json ... ```)
      const codeBlockMatch = response.content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (codeBlockMatch) {
        planJson = JSON.parse(codeBlockMatch[1]);
      } else {
        // Second: try to find the outermost JSON object (from first { to last })
        const firstBrace = response.content.indexOf('{');
        const lastBrace = response.content.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          planJson = JSON.parse(response.content.slice(firstBrace, lastBrace + 1));
        } else {
          planJson = { raw_response: response.content };
        }
      }
    } catch {
      planJson = { raw_response: response.content };
    }

    // Save to database - mark existing active plans as completed
    await supabase
      .from('training_plans')
      .update({ status: 'completed' })
      .eq('user_id', userId)
      .eq('status', 'active');

    const { data: plan, error } = await supabase
      .from('training_plans')
      .insert({
        user_id: userId,
        plan_type: planType,
        plan_json: planJson,
        duration_weeks: durationWeeks,
        start_date: new Date().toISOString().split('T')[0],
        current_week_num: 1,
        status: 'active',
        // Which season this block serves, and which phase of it. Null for a
        // standalone plan — those stay valid and are not retro-fitted.
        macro_plan_id: macroContext.macroPlanId,
        block_number: blockNumber ?? null,
        macro_phase: macroContext.phaseName,
      })
      .select()
      .single();

    if (error) throw error;

    // Get context stats for debugging/monitoring
    const stats = getContextStats(context);

    // Telemetry + critic run after the response — the plan insert above
    // stays synchronous because the response carries the saved plan row.
    after(async () => {
      try {
        const callId = await logCoachCall({
          user_id: userId,
          route: '/api/coach/plans/generate',
          query_type: 'plan_generation',
          model: MODEL_FOR.plan_generation,
          context_tokens: context.totalTokens,
          context_budget: TOKEN_BUDGETS_PER_QUERY.plan_generation,
          ceiling_hit: context.totalTokens >= TOKEN_BUDGETS_PER_QUERY.plan_generation * 0.95,
          cache_used: true,
          preflight_ok: preflight.ok,
          preflight_warnings: serializeWarnings(preflight.warnings),
          preflight_augmented: !!preflight.augmentedSystemSuffix,
          latency_ms: callLatencyMs,
          status: 'ok',
          error_message: null,
          plan_modified: false,
        });

        if (callId) {
          await runCritic({
            userId,
            callId,
            route: '/api/coach/plans/generate',
            queryType: 'plan_generation',
            userQuery: `Generate ${durationWeeks}-week ${planType} plan (target: ${targetRace || 'general fitness'})`,
            coachResponse: response.content,
            contextSummary: `book_sources=${context.bookContext.sources.length} coach_workouts=${context.coachContext.workoutsIncluded.length} duration_weeks=${durationWeeks}`,
            preflightWarnings: preflight.warnings,
          });
        }
      } catch (err) {
        console.warn('plan-gen post-response bookkeeping failed:', err instanceof Error ? err.message : err);
      }
    });

    return NextResponse.json({
      plan,
      rawResponse: response.content,
      sources: {
        books: context.bookContext.sources,
        coachWorkouts: context.coachContext.workoutsIncluded,
      },
      metadata: {
        queryType: 'plan_generation',
        contextStats: stats,
      },
      supervisor: {
        callId: null,
        preflightOk: preflight.ok,
        warnings: preflight.warnings,
      },
    });
  } catch (error) {
    console.error('Error generating plan:', error);
    return NextResponse.json({ error: 'Failed to generate plan' }, { status: 500 });
  }
}

/**
 * Days for this plan: what the request asked for, else what the profile says.
 *
 * Request wins deliberately. `athlete_profile.training_days` is the one
 * human-entered field in this chain that nothing validates, and it sat stale
 * for months while every plan built on it inherited the error. A per-request
 * choice is the athlete stating the days at the moment they are actually
 * deciding, which is the most reliable moment there is.
 *
 * Returns undefined rather than a default when neither source has anything —
 * the prompt then says the days are unspecified instead of quietly inventing
 * Mon/Wed/Fri, which is how the stale value went unnoticed in the first place.
 */
function resolveTrainingDays(
  requested: readonly string[] | undefined,
  profileDays: string | null | undefined,
  dayNotes: string | undefined,
): string | undefined {
  if (requested && requested.length > 0) {
    return dayNotes ? `${requested.join(', ')} (${dayNotes})` : requested.join(', ');
  }
  return profileDays || undefined;
}

/**
 * Season context for a block: which phase it serves, and that phase's targets.
 *
 * Falls back to no context rather than to a guessed phase — a block generated
 * without season context is a valid standalone plan, whereas a block told it
 * serves the wrong phase would build the wrong thing confidently.
 */
async function resolveMacroContext(
  userId: string,
  macroPlanId: string | undefined,
  blockNumber: number | undefined,
): Promise<{ text: string; phaseName: string | null; macroPlanId: string | null }> {
  if (!macroPlanId) return { text: '', phaseName: null, macroPlanId: null };
  const macro = await getActiveMacroPlan(userId);
  if (!macro || macro.id !== macroPlanId) {
    // The referenced season is not this athlete's active one. Silently
    // generating a standalone block is the safe outcome; silently generating
    // against someone else's season is not.
    return { text: '', phaseName: null, macroPlanId: null };
  }
  // Approximate the season week from the block index when one is supplied.
  // Blocks are the unit the athlete thinks in, so block 3 of 12-week blocks
  // starts around season week 25.
  const seasonWeek = blockNumber ? (blockNumber - 1) * 12 + 1 : 1;
  const phase = phaseForWeek(macro, seasonWeek);
  return {
    text: formatMacroPlan(macro, seasonWeek),
    phaseName: phase?.name ?? null,
    macroPlanId: macro.id,
  };
}
