/**
 * READ-ONLY end-to-end check of the plan-generation path.
 *
 * Usage:
 *   bunx tsx scripts/verify-plan-generation.ts --env "C:/Users/ido/running-coach/.env.local"
 *
 * Costs one real Opus call. Writes test-plan-output.json in the working
 * directory and NOTHING to the database.
 *
 * This exists because unit tests cannot answer the question that actually
 * matters for a prompt change: does the model emit the fields we asked for?
 * The first run of this caught two things no test would have — that the plan
 * cited a book which is not loaded (RAG vector search was silently broken; see
 * supabase/migrations/20260903_fix_vector_search_path.sql), and that the new
 * elevation and indoor fields had no UI to render them.
 *
 * Mirrors app/api/coach/plans/generate/route.ts exactly, minus auth and the
 * database write — it must not create an active plan as a side effect of a
 * test, since an active plan drives readiness, the coach note and the
 * scorecard.
 */
import * as dotenv from 'dotenv';
const argv = process.argv.slice(2);
const envIdx = argv.indexOf('--env');
dotenv.config({ path: envIdx >= 0 ? argv[envIdx + 1] : '.env.local' });

async function main() {
  const { buildEnhancedPlanGenerationPrompt, COACH_STATIC_BLOCK } = await import('./lib/ai/coach-prompts');
  const { buildContext } = await import('./lib/rag/context-builder');
  const { buildPlanGenerationContext } = await import('./lib/rag/plan-generation-context');
  const { getAthleteProfile } = await import('./lib/db/profile');
  const { getClimbBaseline } = await import('./lib/db/runs');
  const { callOpenRouter } = await import('./lib/ai/openrouter');
  const { MODEL_FOR } = await import('./lib/ai/model-registry');
  const { supabase } = await import('./lib/db/supabase');

  const { data: prof } = await supabase.from('athlete_profile').select('user_id').limit(1).maybeSingle();
  const userId = (prof as { user_id: string }).user_id;

  const planType = 'Trail / Mountain';
  const durationWeeks = 12;
  const runsPerWeek = 4;
  const trainingDays = 'Sunday, Monday, Wednesday, Friday (Monday quality, Friday long)';
  const raceDistanceKm = 21;
  const raceElevationGainM = 1300;
  const terrainAccess = 'Flat roads locally; Jerusalem-corridor trails 30-45 min drive (Southern Sorek 47 m/km, Nahal Kisalon 21km at 26 m/km); gym stairs, incline treadmill and stair climber.';

  const profile = await getAthleteProfile(userId);
  const climbBaseline = await getClimbBaseline(userId);
  console.log('climb baseline:', JSON.stringify(climbBaseline));

  const contextQuery = `Create a ${durationWeeks}-week ${planType} training plan for 21K mountain race 1300m`;
  const [context, planGenCtx] = await Promise.all([
    buildContext(userId, contextQuery, 'plan_generation', { profile }),
    buildPlanGenerationContext(userId, { raceDate: '2027-07-03', currentWeeklyKm: 30 }),
  ]);

  const systemPrompt = buildEnhancedPlanGenerationPrompt(context, {
    planType, durationWeeks, runsPerWeek,
    targetRace: '21K trail race, 1300m gain, 2027-07-03',
    trainingDays,
    raceDemand: { distanceKm: raceDistanceKm, elevationGainM: raceElevationGainM, terrainAccess, climb: climbBaseline },
    intakeBlock: planGenCtx.intakeBlock,
  });

  console.log('system prompt chars:', systemPrompt.length);
  console.log('RACE DEMAND present:', systemPrompt.includes('RACE DEMAND'));
  console.log('day anchors defer to supplied days:', !systemPrompt.includes('**Monday**: Quality work'));

  const response = await callOpenRouter(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Generate my ${durationWeeks}-week ${planType} training plan. IMPORTANT: Return ONLY the raw JSON object with no markdown code blocks, no explanation, no extra text — just the JSON.` },
    ],
    { apiKey: process.env.OPENROUTER_API_KEY!, model: MODEL_FOR.plan_generation, maxTokens: 16000, cacheableSystemPrefix: COACH_STATIC_BLOCK },
  );

  if (response.error) { console.error('ERROR:', response.error); process.exit(1); }

  const first = response.content.indexOf('{'), last = response.content.lastIndexOf('}');
  const plan = JSON.parse(response.content.slice(first, last + 1));

  const fs = await import('fs');
  fs.writeFileSync('test-plan-output.json', JSON.stringify(plan, null, 2));
  console.log('\nwrote test-plan-output.json');
  console.log('plan_name:', plan.plan_name);
  console.log('weeks returned:', plan.weeks?.length);
}
main().catch((e) => { console.error(e); process.exit(1); });
