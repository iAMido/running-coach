export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { callOpenRouter } from '@/lib/ai/openrouter';
import { buildCoachSystemPrompt, buildPlanAdjustmentPrompt, COACH_STATIC_BLOCK } from '@/lib/ai/coach-prompts';
import { buildTrainingState, formatTrainingState } from '@/lib/coach/training-state';
import { MODEL_FOR } from '@/lib/ai/model-registry';
import { calculateCurrentWeek } from '@/lib/utils/week-calculator';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { planAdjustmentSchema, validateInput } from '@/lib/validation/schemas';

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
    const validation = validateInput(planAdjustmentSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const {
      userRequest,
      adjustmentType = 'user_request',
      weeklyFeedback,
    } = validation.data;

    // Get current active plan
    const { data: plan, error: planError } = await supabase
      .from('training_plans')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (planError || !plan) {
      return NextResponse.json({ error: 'No active training plan found' }, { status: 404 });
    }

    // Calculate current week
    const startDate = plan.start_date || (plan.created_at ? plan.created_at.split('T')[0] : new Date().toISOString().split('T')[0]);
    const weekInfo = calculateCurrentWeek(startDate, plan.duration_weeks);
    const currentWeek = weekInfo.currentWeek;

    // Get athlete profile
    const { data: profile } = await supabase
      .from('athlete_profile')
      .select('*')
      .eq('user_id', userId)
      .single();

    // Get recent runs (last 14 days)
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    const { data: recentRuns } = await supabase
      .from('runs')
      .select('*')
      .eq('user_id', userId)
      .gte('date', twoWeeksAgo.toISOString())
      .order('date', { ascending: false });

    // The same evidence generation reasons over. Without it an adjustment is
    // made from the plan text alone, blind to adherence, vert and efficiency.
    // Best-effort: an outage here must not block a requested change.
    const state = await buildTrainingState(userId, { profile, plan }).catch((err) => {
      console.error('adjust: training state unavailable:', err);
      return null;
    });

    // Build prompts
    const systemPrompt = buildCoachSystemPrompt({ profile });
    const userPrompt = buildPlanAdjustmentPrompt({
      currentPlan: plan.plan_json,
      currentWeek,
      weeklyFeedback,
      recentRuns: recentRuns || [],
      userRequest,
      adjustmentType,
      trainingDays: profile?.training_days ?? null,
      stateText: state ? formatTrainingState(state) : null,
    });

    // COACH_STATIC_BLOCK travels as the cacheable prefix so an adjustment obeys
    // the same standing rules generation does — the indoor-alternative rule,
    // the day-anchor deference, and the reading guides for GAP, decoupling,
    // elevation and HRV. Without it this path was running on an older, smaller
    // rule set and could undo what generation had just been told to do.
    const response = await callOpenRouter(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      {
        apiKey,
        model: MODEL_FOR.plan_adjust,
        maxTokens: 8000,
        cacheableSystemPrefix: COACH_STATIC_BLOCK,
      }
    );

    if (response.error) {
      return NextResponse.json({ error: response.error }, { status: 500 });
    }

    // Try to parse JSON from response
    let adjustmentResult;
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        adjustmentResult = JSON.parse(jsonMatch[0]);
      } else {
        adjustmentResult = { raw_response: response.content };
      }
    } catch {
      adjustmentResult = { raw_response: response.content };
    }

    // If we got structured adjustment data, update the plan
    if (adjustmentResult.adjusted_weeks && Array.isArray(adjustmentResult.adjusted_weeks)) {
      // Merge adjusted weeks into the existing plan
      const existingWeeks = plan.plan_json?.weeks || [];
      const updatedWeeks = [...existingWeeks];

      // Replace weeks from current week onwards with adjusted versions
      for (const adjustedWeek of adjustmentResult.adjusted_weeks) {
        const weekIndex = updatedWeeks.findIndex(w => w.week_number === adjustedWeek.week_number);
        if (weekIndex !== -1) {
          updatedWeeks[weekIndex] = carryForwardElevation(updatedWeeks[weekIndex], adjustedWeek);
        } else {
          updatedWeeks.push(adjustedWeek);
        }
      }

      // Sort weeks by week number
      updatedWeeks.sort((a, b) => a.week_number - b.week_number);

      // Update the plan in database
      const updatedPlanJson = {
        ...plan.plan_json,
        weeks: updatedWeeks,
        last_adjusted: new Date().toISOString(),
        adjustment_history: [
          ...(plan.plan_json?.adjustment_history || []),
          {
            date: new Date().toISOString(),
            type: adjustmentType,
            summary: adjustmentResult.adjustment_summary,
            from_week: currentWeek,
          }
        ]
      };

      const { error: updateError } = await supabase
        .from('training_plans')
        .update({ plan_json: updatedPlanJson })
        .eq('id', plan.id);

      if (updateError) {
        console.error('Failed to update plan:', updateError);
      }

      return NextResponse.json({
        success: true,
        adjustment: adjustmentResult,
        planUpdated: !updateError,
        currentWeek,
      });
    }

    // Return raw response if couldn't parse structured data
    return NextResponse.json({
      success: true,
      adjustment: adjustmentResult,
      planUpdated: false,
      currentWeek,
      message: 'AI provided recommendations but structured plan update was not possible',
    });

  } catch (error) {
    console.error('Error adjusting plan:', error);
    return NextResponse.json({ error: 'Failed to adjust plan' }, { status: 500 });
  }
}

/**
 * Keep a week's elevation prescription across an adjustment that ignored it.
 *
 * An adjustment rewrites whole weeks from model output. If the adjustment
 * prompt does not happen to mention elevation, the model rewrites the week
 * without those fields and the plan silently loses its vert targets — the
 * athlete then sees a mountain plan quietly become a road plan after one
 * mid-block tweak, with nothing in the UI to say it happened.
 *
 * Guaranteed in code rather than asked for in a prompt, because "the model
 * usually remembers" is not a property this can rest on. An adjusted week that
 * DOES carry elevation wins outright — that is a deliberate change, and the
 * whole point of an adjustment is to be allowed to make one.
 */
function carryForwardElevation(
  existing: Record<string, unknown> | undefined,
  adjusted: Record<string, unknown>,
): Record<string, unknown> {
  if (!existing) return adjusted;

  const merged: Record<string, unknown> = { ...adjusted };
  if (merged.total_elevation_gain_m == null && existing.total_elevation_gain_m != null) {
    merged.total_elevation_gain_m = existing.total_elevation_gain_m;
  }

  const oldWorkouts = existing.workouts as Record<string, Record<string, unknown>> | undefined;
  const newWorkouts = merged.workouts as Record<string, Record<string, unknown>> | undefined;
  if (oldWorkouts && newWorkouts) {
    for (const [day, workout] of Object.entries(newWorkouts)) {
      const before = oldWorkouts[day];
      if (!before || !workout) continue;
      // Only fills gaps. A day whose session genuinely changed keeps its new
      // values; a day the model merely restated keeps what it had.
      if (workout.elevation_gain_m == null && before.elevation_gain_m != null) {
        workout.elevation_gain_m = before.elevation_gain_m;
      }
      if (workout.indoor_alternative == null && before.indoor_alternative != null) {
        workout.indoor_alternative = before.indoor_alternative;
      }
    }
  }
  return merged;
}
