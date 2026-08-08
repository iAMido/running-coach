export const runtime = 'nodejs';

import { NextRequest, NextResponse, after } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { callOpenRouter } from '@/lib/ai/openrouter';
import { buildEnhancedWeeklyAnalysisPrompt, buildCoachDynamicBlock, COACH_STATIC_BLOCK } from '@/lib/ai/coach-prompts';
import { buildContext } from '@/lib/rag/context-builder';
import { getEfficiencyRuns } from '@/lib/rag/user-formatter';
import { buildEfficiencySummary, formatEfficiency } from '@/lib/utils/efficiency';
import { userDateStr, shiftedDateStr } from '@/lib/utils/user-time';
import { buildScorecardForUser } from '@/lib/coach/weekly-scorecard';
import { formatScorecard } from '@/lib/utils/scorecard';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { reviewAnalysisSchema, validateInput } from '@/lib/validation/schemas';
import { getActivePlan } from '@/lib/db/plans';
import { calculateCurrentWeek } from '@/lib/utils/week-calculator';
import { nowInUserTz } from '@/lib/utils/user-time';
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

    // Get this week's runs. Week starts on SUNDAY to match the training
    // plan's Sun-Sat structure (and the dashboard's date range). The
    // previous Mon-based boundary caused the AI to miss runs logged on
    // Sundays — e.g. Jun 7 Evening Run rendered as "skipped" in the
    // review because the query window started on Jun 8.
    const now = nowInUserTz(); // Israel-local "now" — Vercel is UTC
    const dayOfWeek = now.getDay();        // 0 = Sunday
    const sunday = new Date(now);
    sunday.setDate(now.getDate() - dayOfWeek);
    sunday.setHours(0, 0, 0, 0);

    // Runs, feedback, plan, and the RAG context are all independent —
    // fetch together (previously 5 serial awaits). The plan is threaded
    // into buildContext so it isn't re-queried inside (it used to be
    // fetched 3x per review request across route/context/formatter).
    const [{ data: runs }, { data: feedback }, activePlan] = await Promise.all([
      supabase
        .from('runs')
        .select('*')
        .eq('user_id', userId)
        .gte('date', sunday.toISOString())
        .order('date', { ascending: true }),
      supabase
        .from('run_feedback')
        .select('*')
        .eq('user_id', userId)
        .gte('run_date', sunday.toISOString().split('T')[0]),
      getActivePlan(userId),
    ]);

    // Laps need runIds, so they follow; the RAG context can overlap with them.
    const runRows = (runs || []) as Run[];
    const runIds = runRows.map(r => r.id);
    const [{ data: lapsData }, context] = await Promise.all([
      runIds.length > 0
        ? supabase.from('laps').select('*').in('run_id', runIds).order('lap_number', { ascending: true })
        : Promise.resolve({ data: [] as Lap[] }),
      buildContext(userId, 'weekly review analysis', 'plan_review', { plan: activePlan }),
    ]);
    const lapRows = (lapsData || []) as Lap[];
    const runsWithLaps: (Run & { laps?: Lap[] })[] = runRows.map(run => ({
      ...run,
      laps: lapRows.filter(l => l.run_id === run.id),
    }));

    // Aerobic efficiency: the weekly review is where trend metrics belong, and
    // where this can sit beside CTL so the two answer "is the training working"
    // together. It changes 1-2% in three weeks, so it has no business on a
    // dashboard tile. Best-effort — a review must never fail over a trend line.
    let efficiency = '';
    try {
      efficiency = formatEfficiency(
        buildEfficiencySummary(await getEfficiencyRuns(userId), userDateStr()),
      );
    } catch (err) {
      console.error('weekly review: efficiency block unavailable:', err);
    }

    // The same scorecard object the review page renders, so the coach cannot
    // describe the week differently from the card sitting above its analysis.
    // `sunday` here is a plain local Date built from calendar fields, so its
    // own fields are the week boundary — shiftedDateStr, not userDateStr.
    let scorecard = '';
    try {
      const saturday = new Date(sunday);
      saturday.setDate(saturday.getDate() + 6);
      scorecard = formatScorecard(
        await buildScorecardForUser(userId, shiftedDateStr(sunday), shiftedDateStr(saturday), activePlan),
      );
    } catch (err) {
      console.error('weekly review: scorecard unavailable:', err);
    }

    const reviewWeekNumber = activePlan?.start_date
      ? calculateCurrentWeek(activePlan.start_date, activePlan.duration_weeks, sunday).currentWeek
      : undefined;

    // Pre-flight supervisor gate. plan_review specifically flags when no
    // active plan covers this week and when no runs were logged.
    const preflight = supervisorValidate({
      context,
      queryType: 'plan_review',
      plan: activePlan,
      weekRuns: runsWithLaps as Run[],
    });

    // Dynamic system block only — the static persona/instructions travel
    // as cacheableSystemPrefix (byte-stable → Anthropic cache hits on
    // retries/re-rolls within 5 minutes).
    let systemPrompt = buildCoachDynamicBlock(context);
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
      efficiency,
      scorecard,
    });

    const callStart = Date.now();
    const response = await callOpenRouter(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { apiKey, model: MODEL_FOR.weekly_review, maxTokens: 2000, cacheableSystemPrefix: COACH_STATIC_BLOCK }
    );
    const callLatencyMs = Date.now() - callStart;

    if (response.error) {
      return NextResponse.json({ error: response.error }, { status: 500 });
    }

    // Save the analysis (Sun-Sat week boundary)
    const weekStart = sunday.toISOString().split('T')[0];
    const saturday = new Date(sunday);
    saturday.setDate(sunday.getDate() + 6);
    const weekEnd = saturday.toISOString().split('T')[0];

    // Persistence + telemetry + critic all run after the response — the
    // user sees the analysis immediately instead of waiting for four DB
    // writes and a Haiku call. after() carries a platform guarantee the
    // work completes (unlike the previous un-awaited .catch pattern).
    after(async () => {
      try {
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
          await runCritic({
            userId,
            callId,
            route: '/api/coach/review/analyze',
            queryType: 'plan_review',
            userQuery: `Weekly review for week starting ${weekStart}`,
            coachResponse: response.content,
            contextSummary: `runs=${(runs || []).length} week_number=${reviewWeekNumber} plan_loaded=${!!activePlan}`,
            preflightWarnings: preflight.warnings,
          });
        }
      } catch (err) {
        console.warn('review post-response bookkeeping failed:', err instanceof Error ? err.message : err);
      }
    });

    return NextResponse.json({
      analysis: response.content,
      supervisor: {
        callId: null,
        preflightOk: preflight.ok,
        warnings: preflight.warnings,
      },
    });
  } catch (error) {
    console.error('Error analyzing week:', error);
    return NextResponse.json({ error: 'Failed to analyze week' }, { status: 500 });
  }
}
