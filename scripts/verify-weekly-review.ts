/**
 * READ-ONLY check of the weekly-review path, run against one or more models
 * on the SAME prompt so their reviews can be compared side by side.
 *
 * Usage:
 *   bunx tsx scripts/verify-weekly-review.ts --env .env.local [--models a,b]
 *
 * Mirrors app/api/coach/review/analyze/route.ts (current Sun-Sat week, same
 * context, scorecard, efficiency block and token limits) minus auth, the
 * wellness form, and the coach_reports write. Writes
 * test-weekly-review-<model>.md per model and NOTHING to the database.
 */
import * as dotenv from 'dotenv';

const argv = process.argv;
const envIdx = argv.indexOf('--env');
dotenv.config({ path: envIdx >= 0 ? argv[envIdx + 1] : '.env.local' });
const modelsIdx = argv.indexOf('--models');

(async () => {
  const fs = await import('fs');
  const { supabase } = await import('../lib/db/supabase');
  const { callOpenRouter } = await import('../lib/ai/openrouter');
  const { buildEnhancedWeeklyAnalysisPrompt, buildCoachDynamicBlock, COACH_STATIC_BLOCK } = await import('../lib/ai/coach-prompts');
  const { buildContext } = await import('../lib/rag/context-builder');
  const { getEfficiencyRuns } = await import('../lib/rag/user-formatter');
  const { buildEfficiencySummary, formatEfficiency } = await import('../lib/utils/efficiency');
  const { userDateStr, shiftedDateStr, nowInUserTz } = await import('../lib/utils/user-time');
  const { buildScorecardForUser } = await import('../lib/coach/weekly-scorecard');
  const { formatScorecard } = await import('../lib/utils/scorecard');
  const { getActivePlan } = await import('../lib/db/plans');
  const { calculateCurrentWeek } = await import('../lib/utils/week-calculator');
  const { MODEL_FOR, REASONING_FOR, WEEKLY_REVIEW_MAX_TOKENS } = await import('../lib/ai/model-registry');
  type Run = import('../lib/db/types').Run;
  type Lap = import('../lib/db/types').Lap;

  const models = modelsIdx >= 0 ? argv[modelsIdx + 1].split(',') : [MODEL_FOR.weekly_review];

  const { data: prof } = await supabase.from('athlete_profile').select('user_id').limit(1).maybeSingle();
  const userId = (prof as { user_id: string }).user_id;

  const now = nowInUserTz();
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - now.getDay());
  sunday.setHours(0, 0, 0, 0);

  const [{ data: runs }, { data: feedback }, activePlan] = await Promise.all([
    supabase.from('runs').select('*').eq('user_id', userId).gte('date', sunday.toISOString()).order('date', { ascending: true }),
    supabase.from('run_feedback').select('*').eq('user_id', userId).gte('run_date', sunday.toISOString().split('T')[0]),
    getActivePlan(userId),
  ]);
  const runRows = (runs || []) as Run[];
  const runIds = runRows.map(r => r.id);
  const [{ data: lapsData }, context] = await Promise.all([
    runIds.length > 0
      ? supabase.from('laps').select('*').in('run_id', runIds).order('lap_number', { ascending: true })
      : Promise.resolve({ data: [] as Lap[] }),
    buildContext(userId, 'weekly review analysis', 'plan_review', { plan: activePlan }),
  ]);
  const lapRows = (lapsData || []) as Lap[];
  const runsWithLaps = runRows.map(run => ({ ...run, laps: lapRows.filter(l => l.run_id === run.id) }));

  const efficiency = formatEfficiency(buildEfficiencySummary(await getEfficiencyRuns(userId), userDateStr()));
  const saturday = new Date(sunday);
  saturday.setDate(saturday.getDate() + 6);
  const scorecard = formatScorecard(
    await buildScorecardForUser(userId, shiftedDateStr(sunday), shiftedDateStr(saturday), activePlan),
  );
  const weekNumber = activePlan?.start_date
    ? calculateCurrentWeek(activePlan.start_date, activePlan.duration_weeks, sunday).currentWeek
    : undefined;

  const userPrompt = buildEnhancedWeeklyAnalysisPrompt(context, {
    runs: runsWithLaps, feedback: feedback || [], overallFeeling: undefined, sleepQuality: undefined,
    stressLevel: undefined, injuryNotes: undefined, achievements: undefined,
    plan: activePlan, weekNumber, efficiency, scorecard,
  } as Parameters<typeof buildEnhancedWeeklyAnalysisPrompt>[1]);

  console.log(`week of ${shiftedDateStr(sunday)} · ${runRows.length} runs · plan week ${weekNumber ?? '-'}`);

  for (const model of models) {
    const t = Date.now();
    const r = await callOpenRouter(
      [
        { role: 'system', content: buildCoachDynamicBlock(context) },
        { role: 'user', content: userPrompt },
      ],
      { apiKey: process.env.OPENROUTER_API_KEY!, model, maxTokens: WEEKLY_REVIEW_MAX_TOKENS,
        // Only the production model gets the production thinking budget; a
        // comparison model runs as it was configured before.
        reasoningTokens: model === MODEL_FOR.weekly_review ? REASONING_FOR.weekly_review : undefined,
        cacheableSystemPrefix: COACH_STATIC_BLOCK },
    );
    const secs = ((Date.now() - t) / 1000).toFixed(1);
    const file = `test-weekly-review-${model.replace(/[/.]/g, '_')}.md`;
    fs.writeFileSync(file, r.content || `ERROR: ${r.error}`);
    console.log(`${model}: ${secs}s · finish ${r.finishReason} · ${r.completionTokens} tokens (${r.reasoningTokensUsed ?? 0} thinking) · ${(r.content || '').length} chars · err ${r.error ?? '-'} → ${file}`);
  }
})();
