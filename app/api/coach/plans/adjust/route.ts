import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { callOpenRouter } from '@/lib/ai/openrouter';
import { buildCoachSystemPrompt, buildPlanAdjustmentPrompt } from '@/lib/ai/coach-prompts';
import { calculateCurrentWeek } from '@/lib/utils/week-calculator';
import { getAuthenticatedUser } from '@/lib/auth/get-user';

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
    const {
      userRequest,
      adjustmentType = 'user_request',
      weeklyFeedback,
    } = body;

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

    // Build prompts
    const systemPrompt = buildCoachSystemPrompt({ profile });
    const userPrompt = buildPlanAdjustmentPrompt({
      currentPlan: plan.plan_json,
      currentWeek,
      weeklyFeedback,
      recentRuns: recentRuns || [],
      userRequest,
      adjustmentType,
    });

    // Call OpenRouter
    const response = await callOpenRouter(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { apiKey, maxTokens: 8000 }
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
          updatedWeeks[weekIndex] = adjustedWeek;
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
