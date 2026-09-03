/**
 * READ-ONLY-ish check of the season layer: generates a macro plan and prints
 * it. Writes ONE macro_plans row (superseding any active one), which is the
 * real behaviour being tested. One Opus call.
 *
 * Usage: bunx tsx scripts/verify-macro-plan.ts --env "<path>" [--commit]
 */
import * as dotenv from 'dotenv';
const argv = process.argv.slice(2);
const i = argv.indexOf('--env');
dotenv.config({ path: i >= 0 ? argv[i + 1] : '.env.local' });
const COMMIT = argv.includes('--commit');

async function main() {
  const { supabase } = await import('../lib/db/supabase');
  const { buildMacroPlanPrompt, suggestedPhaseCount } = await import('../lib/ai/macro-plan-prompt');
  const { buildTrainingState } = await import('../lib/coach/training-state');
  const { getAthleteProfile } = await import('../lib/db/profile');
  const { getClimbBaseline } = await import('../lib/db/runs');
  const { callOpenRouter } = await import('../lib/ai/openrouter');
  const { COACH_STATIC_BLOCK } = await import('../lib/ai/coach-prompts');
  const { MODEL_FOR } = await import('../lib/ai/model-registry');
  const { saveMacroPlan, formatMacroPlan } = await import('../lib/coach/macro-plan');

  const { data } = await supabase.from('athlete_profile').select('user_id').limit(1).maybeSingle();
  const userId = (data as { user_id: string }).user_id;

  const horizonWeeks = 43;
  console.log(`horizon ${horizonWeeks}w -> suggested phases: ${suggestedPhaseCount(horizonWeeks)}`);
  for (const h of [6, 12, 18, 26, 43, 52]) console.log(`   ${h}w -> ${suggestedPhaseCount(h)} phases`);

  const profile = await getAthleteProfile(userId);
  const [state, climb] = await Promise.all([
    buildTrainingState(userId, { profile, plan: null }),
    getClimbBaseline(userId),
  ]);

  const prompt = buildMacroPlanPrompt({
    goalName: '21K trail race, 1300m elevation gain',
    raceDate: '2027-07-03',
    horizonWeeks,
    runsPerWeek: 4,
    trainingDays: profile?.training_days || undefined,
    raceDemand: {
      distanceKm: 21, elevationGainM: 1300,
      terrainAccess: 'Flat roads locally; Jerusalem-corridor trails 30-45 min drive (up to 47 m/km); gym stairs, incline treadmill, stair climber.',
      climb,
    },
    state,
  });
  console.log(`\nprompt chars: ${prompt.length}`);

  const res = await callOpenRouter(
    [{ role: 'system', content: prompt }, { role: 'user', content: 'Design my season. Return ONLY the raw JSON object.' }],
    { apiKey: process.env.OPENROUTER_API_KEY!, model: MODEL_FOR.plan_generation, maxTokens: 6000, cacheableSystemPrefix: COACH_STATIC_BLOCK },
  );
  if (res.error) { console.error(res.error); process.exit(1); }
  const f = res.content.indexOf('{'), l = res.content.lastIndexOf('}');
  const parsed = JSON.parse(res.content.slice(f, l + 1));

  console.log(`\nphases returned: ${parsed.phases.length}`);
  console.log(`weeks sum: ${parsed.phases.reduce((s: number, p: { weeks: number }) => s + p.weeks, 0)} (asked for ${horizonWeeks})`);
  console.log(`rationale: ${parsed.rationale}\n`);
  for (const p of parsed.phases) {
    console.log(`Phase ${p.phase_number}: ${p.name} (${p.weeks}w)`);
    console.log(`   capability: ${p.capability}`);
    console.log(`   km ${JSON.stringify(p.weekly_km_range)}  vert ${JSON.stringify(p.weekly_vert_range_m)}  LR ceiling ${p.long_run_vert_ceiling_m}`);
    for (const c of p.exit_criteria ?? []) console.log(`   exit: ${c}`);
  }

  if (COMMIT) {
    const saved = await saveMacroPlan(userId, {
      goal_name: parsed.goal_name, race_date: '2027-07-03', race_distance_km: 21,
      race_elevation_gain_m: 1300, terrain_access: null, horizon_weeks: horizonWeeks,
      phases: parsed.phases, rationale: parsed.rationale,
    });
    console.log(`\nSAVED macro plan ${saved?.id} (revision ${saved?.revision})`);
    console.log('\n' + formatMacroPlan(saved!, 1).slice(0, 600));
  } else {
    console.log('\n(dry run — pass --commit to save)');
  }
}
main().catch(e => { console.error(e); process.exit(1); });
