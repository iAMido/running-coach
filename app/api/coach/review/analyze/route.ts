export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { callOpenRouter } from '@/lib/ai/openrouter';
import { buildEnhancedWeeklyAnalysisPrompt, buildEnhancedCoachSystemPrompt } from '@/lib/ai/coach-prompts';
import { buildContext } from '@/lib/rag/context-builder';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { reviewAnalysisSchema, validateInput } from '@/lib/validation/schemas';
import { getActivePlan } from '@/lib/db/plans';
import { calculateCurrentWeek } from '@/lib/utils/week-calculator';
import type { Run, Lap } from '@/lib/db/types';
import {
  validateContext as supervisorValidate,
  serializeWarnings,
  logCoachCall,
  runCritic,
} from '@/lib/supervisor';
import { TOKEN_BUDGETS_PER_QUERY } from '@/lib/rag/types';
import { MODEL_FOR } from '@/lib/ai/model-registry';

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
    const validation = validateInput(reviewAnalysisSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const { overallFeeling, sleepQuality, stressLevel, injuryNotes, achievements } = validation.data;

    // Get this week's runs
    const now = new Date();
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    monday.setHours(0, 0, 0, 0);

    const { data: runs } = await supabase
      .from('runs')
      .select('*')
      .eq('user_id', userId)
      .gte('date', monday.toISOString())
      .order('date', { ascending: true });

    // Get feedback for this week's runs
    const { data: feedback } = await supabase
      .from('run_feedback')
      .select('*')
      .eq('user_id', userId)
      .gte('run_date', monday.toISOString().split('T')[0]);

    // Fetch laps for this week's runs and attach to each run
    const runRows = (runs || []) as Run[];
    const runIds = runRows.map(r => r.id);
    const { data: lapsData } = runIds.length > 0
      ? await supabase.from('laps').select('*').in('run_id', runIds).order('lap_number', { ascending: true })
      : { data: [] };
    const lapRows = (lapsData || []) as Lap[];
    const runsWithLaps: (Run & { laps?: Lap[] })[] = runRows.map(run => ({
      ...run,
      laps: lapRows.filter(l => l.run_id === run.id),
    }));

    // Build 3-layer RAG context
    const context = await buildContext(
      userId,
      'weekly review analysis',
      'plan_review'
    );

    // Resolve the planned week for this calendar week so the prompt can show PLANNED vs ACTUAL.
    const activePlan = await getActivePlan(userId);
    const reviewWeekNumber = activePlan?.start_date
      ? calculateCurrentWeek(activePlan.start_date, activePlan.duration_weeks, monday).currentWeek
      : undefined;

    // Pre-flight supervisor gate. plan_review specifically flags when no
    // active plan covers this week and when no runs were logged.
    const preflight = supervisorValidate({
      context,
      queryType: 'plan_review',
      plan: activePlan,
      weekRuns: runsWithLaps as Run[],
    });

    // Build prompts using enhanced system
    let systemPrompt = buildEnhancedCoachSystemPrompt(context);
    if (preflight.augmentedSystemSuffix) {
      systemPrompt = systemPrompt + preflight.augmentedSystemSuffix;
    }
    const userPrompt = buildEnhancedWeeklyAnalysisPrompt(context, {
      runs: runsWithLaps,
      feedback: feedback || [],
      overallFeeling,
      sleepQuality,
      stressLevel,
      injuryNotes,
      achievements,
      plan: activePlan,
      weekNumber: reviewWeekNumber,
    });

    // Call OpenRouter. cacheSystemPrompt: most of the methodology / RAG
    // block is identical across consecutive review attempts in a session
    // (retry, re-roll, etc.), so caching saves real cost.
    const callStart = Date.now();
    const response = await callOpenRouter(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { apiKey, model: MODEL_FOR.weekly_review, maxTokens: 2000, cacheSystemPrompt: true }
    );
    const callLatencyMs = Date.now() - callStart;

    if (response.error) {
      return NextResponse.json({ error: response.error }, { status: 500 });
    }

    // Save the analysis
    const weekStart = monday.toISOString().split('T')[0];
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const weekEnd = sunday.toISOString().split('T')[0];

    await supabase
      .from('weekly_summaries')
      .upsert({
        user_id: userId,
        week_start: weekStart,
        overall_feeling: overallFeeling,
        sleep_quality: sleepQuality,
        stress_level: stressLevel,
        injury_notes: injuryNotes,
        achievements,
        ai_analysis: response.content,
      }, { onConflict: 'user_id,week_start' });

    // Save to coach_reports for history
    const titleMatch = response.content.match(/^##?\s+(.+)/m);
    const title = titleMatch ? titleMatch[1].replace(/\*+/g, '').trim() : `Weekly Review: ${weekStart}`;

    await supabase
      .from('coach_reports')
      .upsert({
        user_id: userId,
        report_type: 'weekly_review',
        title,
        content: response.content,
        week_start: weekStart,
        week_end: weekEnd,
        metadata: {
          runs_count: (runs || []).length,
          total_km: (runs || []).reduce((s: number, r: { distance_km?: number }) => s + (r.distance_km || 0), 0),
          overall_feeling: overallFeeling,
          sleep_quality: sleepQuality,
          stress_level: stressLevel,
        },
      }, { onConflict: 'user_id,week_start,report_type' });

    // Supervisor telemetry + critic
    const callId = await logCoachCall({
      user_id: userId,
      route: '/api/coach/review/analyze',
      query_type: 'plan_review',
      model: MODEL_FOR.weekly_review,
      context_tokens: context.totalTokens,
      context_budget: TOKEN_BUDGETS_PER_QUERY.plan_review,
      ceiling_hit: context.totalTokens >= TOKEN_BUDGETS_PER_QUERY.plan_review * 0.95,
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
      runCritic({
        userId,
        callId,
        route: '/api/coach/review/analyze',
        queryType: 'plan_review',
        userQuery: `Weekly review for week starting ${weekStart}`,
        coachResponse: response.content,
        contextSummary: `runs=${(runs || []).length} week_number=${reviewWeekNumber} plan_loaded=${!!activePlan}`,
        preflightWarnings: preflight.warnings,
      }).catch(err => console.warn('critic failed:', err?.message));
    }

    return NextResponse.json({
      analysis: response.content,
      supervisor: {
        callId,
        preflightOk: preflight.ok,
        warnings: preflight.warnings,
      },
    });
  } catch (error) {
    console.error('Error analyzing week:', error);
    return NextResponse.json({ error: 'Failed to analyze week' }, { status: 500 });
  }
}
