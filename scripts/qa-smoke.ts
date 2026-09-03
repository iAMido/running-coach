/**
 * Functional smoke test across the RunCoach feature surface.
 *
 * Exercises the real library and database paths against real data. READ-ONLY:
 * no writes, no LLM calls. Auth-gated HTTP handlers are not exercised directly
 * — those need a logged-in session — but everything they call is.
 *
 * Usage: bunx tsx scripts/qa-smoke.ts --env "<path to .env.local>"
 */
import * as dotenv from 'dotenv';

const argv = process.argv.slice(2);
const ei = argv.indexOf('--env');
dotenv.config({ path: ei >= 0 ? argv[ei + 1] : '.env.local' });

let pass = 0;
let fail = 0;
const problems: string[] = [];

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}${detail ? ` - ${detail}` : ''}`);
  } else {
    fail++;
    problems.push(name);
    console.log(`  FAIL  ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

async function main() {
  const { supabase } = await import('../lib/db/supabase');
  const { data: prof } = await supabase.from('athlete_profile').select('user_id').limit(1).maybeSingle();
  const userId = (prof as { user_id: string }).user_id;

  console.log('\n== profile & settings ==');
  const { getAthleteProfile } = await import('../lib/db/profile');
  const profile = await getAthleteProfile(userId);
  check('profile loads', !!profile);
  check('max HR set', typeof profile?.max_hr === 'number', String(profile?.max_hr));
  check('HR zones set', !!profile?.hr_zone_z2, profile?.hr_zone_z2 ?? '');
  check('training days set', !!profile?.training_days);

  console.log('\n== runs & log ==');
  const { getUserRuns, getRecentRunsWithLaps, getClimbBaseline } = await import('../lib/db/runs');
  const runs = await getUserRuns(userId, 20);
  check('runs load', runs.length > 0, `${runs.length}`);
  const withLaps = await getRecentRunsWithLaps(userId, 10);
  check('runs-with-laps load', withLaps.length > 0, `${withLaps.length}`);
  const climb = await getClimbBaseline(userId);
  check('climb baseline computes', climb.measuredRuns > 0, `${climb.measuredRuns} runs, max ${climb.maxVertPerKm?.toFixed(1)} m/km`);

  console.log('\n== readiness ==');
  const { readinessForUser } = await import('../lib/coach/readiness-service');
  const { getActivePlan } = await import('../lib/db/plans');
  const plan = await getActivePlan(userId);
  const r = await readinessForUser(userId, plan);
  check('readiness verdict', ['GO', 'EASY', 'REST'].includes(r.readiness.verdict), r.readiness.verdict);
  check('readiness gives reasons', r.readiness.reasons.length > 0);

  console.log('\n== wellness ==');
  const { getLatestRecoveryReading, getWellnessBaselines } = await import('../lib/db/wellness');
  const rec = await getLatestRecoveryReading(userId);
  check('recovery reading found', rec !== null, rec ? `age ${rec.ageDays}d` : 'none');
  const base = await getWellnessBaselines(userId);
  check('wellness baselines', base.hrvBaseline !== null || base.restingHrBaseline !== null);

  console.log('\n== training state ==');
  const { buildTrainingState, formatTrainingState } = await import('../lib/coach/training-state');
  const state = await buildTrainingState(userId);
  check('state assembles', state.weeks.length > 0, `${state.weeks.length} weeks`);
  check('adherence computed', state.adherence.rate !== null, state.adherence.rate ? `${(state.adherence.rate * 100).toFixed(0)}%` : 'n/a');
  check('gaps are named, not hidden', Array.isArray(state.gaps), `${state.gaps.length} gaps`);
  check('state renders', formatTrainingState(state).includes('TRAINING STATE'));

  console.log('\n== scorecard ==');
  const { buildScorecardForUser } = await import('../lib/coach/weekly-scorecard');
  const card = await buildScorecardForUser(userId, '2026-08-23', '2026-08-29');
  check('scorecard builds', card.rows.length === 4, `${card.rows.length} rows`);
  check('climb row present', card.rows.some((x) => x.key === 'climb'));
  const everyRowJustified = card.rows.every((x) =>
    x.colour !== null ? !!x.detail : !!(x as { colourless?: string }).colourless);
  check('no colourless row without a stated reason', everyRowJustified);

  console.log('\n== RAG (all three layers) ==');
  const { buildContext } = await import('../lib/rag/context-builder');
  const ctx = (await buildContext(userId, 'How should I train for a steep mountain race?', 'ask_coach', { profile })) as unknown as Record<string, {
    tokenCount?: number; sources?: unknown[];
  }>;
  check('user layer', (ctx.userContext?.tokenCount ?? 0) > 0, `${ctx.userContext?.tokenCount} tok`);
  check('coach layer', (ctx.coachContext?.tokenCount ?? 0) > 0, `${ctx.coachContext?.tokenCount} tok`);
  check('book layer', (ctx.bookContext?.tokenCount ?? 0) > 0, `${ctx.bookContext?.tokenCount} tok, ${ctx.bookContext?.sources?.length ?? 0} sources`);

  console.log('\n== supervisor ==');
  const { validateContext } = await import('../lib/supervisor/preflight');
  const pf = validateContext({ context: ctx as never, queryType: 'ask_coach' });
  check('preflight runs', typeof pf.ok === 'boolean', `${pf.warnings.length} warnings`);
  const emptyBooks = { ...ctx, bookContext: { ...ctx.bookContext, sources: [] } };
  const pf2 = validateContext({ context: emptyBooks as never, queryType: 'ask_coach' });
  check('empty RAG is flagged on CHAT too', pf2.warnings.some((w) => w.code === 'no_book_sources'));

  console.log('\n== plan / season ==');
  const { getActiveMacroPlan } = await import('../lib/coach/macro-plan');
  const macro = await getActiveMacroPlan(userId);
  check('macro plan query works', macro === null || Array.isArray(macro.phases), macro ? `${macro.phases.length} phases` : 'none active');
  check('active plan query works', plan === null || !!plan.plan_json, plan ? plan.plan_type : 'none active');

  console.log('\n== weekly proposal ==');
  const { evaluateTriggers, shouldPropose } = await import('../lib/coach/proposal-triggers');
  const trig = evaluateTriggers({ state, phase: null, weeksIntoPhase: null });
  check('triggers evaluate', Array.isArray(trig), `${trig.length} fired`);
  const expected = trig.some((t) => t.urgent) || trig.length >= 2;
  check('hysteresis matches the rule', shouldPropose(trig) === expected, shouldPropose(trig) ? 'would propose' : 'no change');

  console.log('\n== intervals.icu ==');
  const { intervalsClientFromEnv } = await import('../lib/intervals/client');
  const { userDateStr, userDateStrDaysAgo } = await import('../lib/utils/user-time');
  try {
    const client = intervalsClientFromEnv();
    const acts = await client.getActivities(userDateStrDaysAgo(14), userDateStr());
    check('intervals.icu reachable', Array.isArray(acts), `${acts.length} activities/14d`);
    // Same window the push-week gate uses, so this tests the real call.
    const maxHr = await client.getAthleteMaxHr(userDateStrDaysAgo(60), userDateStr());
    check('max HR agrees with profile', maxHr === profile?.max_hr, `icu ${maxHr} vs app ${profile?.max_hr}`);
  } catch (e) {
    check('intervals.icu reachable', false, e instanceof Error ? e.message : String(e));
  }

  console.log('\n== watch push (dry) ==');
  const { planWorkoutToDescription } = await import('../lib/intervals/workout-format');
  const { parseZonesFromProfile } = await import('../lib/utils/zones');
  const bands = parseZonesFromProfile(profile);
  const t = planWorkoutToDescription(
    { type: 'Long Run', duration: '90 min', target_hr: 'Z1-Z2 (125-145)', elevation_gain_m: 400 },
    bands,
    profile!.max_hr!,
  );
  check('workout translates to % HR', !!t && /^- \d+m [\d.]+-[\d.]+% HR$/.test(t.description), t?.description);
  check('climb target travels as a note', !!t?.notes.some((n) => n.includes('400 m')));

  console.log('\n== caltrack boundary ==');
  const { caltrackDb } = await import('../lib/db/supabase-caltrack');
  const { error: ctErr } = await caltrackDb.from('meals').select('id').limit(1);
  check('caltrack client reaches its own schema', !ctErr, ctErr?.message ?? 'ok');
  const { error: leakErr } = await supabase.from('meals').select('id').limit(1);
  check('runcoach client CANNOT see caltrack tables', !!leakErr, leakErr ? 'correctly isolated' : 'LEAK: schemas are not separated');

  console.log(`\n===== ${pass} passed, ${fail} failed =====`);
  if (problems.length) console.log('failures: ' + problems.join(' | '));
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
