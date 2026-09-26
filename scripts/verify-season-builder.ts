/**
 * End-to-end DRY RUN of the staged SEASON builder (lib/coach/plan-builder/season.ts):
 * every stage runs for real, the save stage refuses to touch macro_plans.
 *
 * Usage:
 *   bunx tsx scripts/verify-season-builder.ts --env .env.local [--score <season.json>]... [--phase1]
 *
 * --phase1 then builds phase 1 from the season's brief, DRY RUN, against a
 * TEMPORARY season row saved as 'superseded' (so the athlete's real season is
 * never replaced), scores it against the phase's ranges and KPIs, evaluates the
 * phase KPIs on his real data, and deletes the temporary row.
 *
 * Also scores, with the same season rules: the athlete's ACTIVE season (made
 * by the single-call route) and any --score file (e.g. a fresh single-call
 * season from scripts/verify-macro-plan.ts --out), so old and new are judged
 * identically.
 */
import * as dotenv from 'dotenv';

const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
dotenv.config({ path: flag('--env') ?? '.env.local' });

const REQUEST = {
  goalName: 'Zermatt-style mountain half marathon (21 km, 1300 m climb)',
  raceDate: '2027-07-03',
  horizonWeeks: 40,
  raceDistanceKm: 21,
  raceElevationGainM: 1300,
  terrainAccess: 'Flat roads locally; Jerusalem-corridor trails 30-45 min drive (Southern Sorek 47 m/km, Nahal Kisalon 21km at 26 m/km); gym stairs, incline treadmill and stair climber.',
};

(async () => {
  const fs = await import('fs');
  const { supabase } = await import('../lib/db/supabase');
  const { createBuild, advance } = await import('../lib/coach/plan-builder/runner');
  const { SEASON_STAGE_LABELS } = await import('../lib/coach/plan-builder/view');
  const { checkSeason, normalizeSeason, renderSeason } = await import('../lib/coach/plan-builder/season-checks');
  const { scoreViolations } = await import('../lib/coach/plan-builder/checks');
  type SeasonDraft = import('../lib/coach/plan-builder/types').SeasonDraft;

  const { data: prof } = await supabase.from('athlete_profile').select('user_id').limit(1).maybeSingle();
  const userId = (prof as { user_id: string }).user_id;

  const t0 = Date.now();
  let row = await createBuild(userId, REQUEST, { dryRun: true, kind: 'season' });
  console.log(`season build ${row.id}`);
  while (row.stage !== 'done' && row.stage !== 'failed') {
    const from = row.stage;
    const s = Date.now();
    ({ row } = await advance(userId, row.id));
    console.log(`  ${SEASON_STAGE_LABELS[from].padEnd(40)} ${((Date.now() - s) / 1000).toFixed(0).padStart(4)} s → ${row.stage}${row.error ? `  (${row.error})` : ''}`);
  }
  console.log(`total ${((Date.now() - t0) / 1000).toFixed(0)} s · stage ${row.stage}`);
  if (row.stage === 'failed' || !row.season) process.exit(1);

  const s = row.season;
  console.log(`\nSEASON: ${s.goal_name}\n  rationale: ${s.rationale}\n  decisions: ${s.decisions.join(' | ')}`);
  console.log(renderSeason(s));
  for (const r of row.checks?.repairs ?? []) console.log(`  repair ${r.round}: phases ${r.weeks.join(',')} · errors ${r.errorsBefore} → ${r.errorsAfter}`);
  for (const r of row.reviews) {
    console.log(`\nREVIEW ${r.round}: ${r.verdict}${r.fixApplied ? ' (fix applied)' : ''} — ${r.summary}`);
    for (const i of r.issues) console.log(`  ${i.severity === 'must_fix' ? '!' : '·'} P${i.weeks.join(',')} ${i.problem}\n      → ${i.fix}`);
  }

  const stages = Object.entries(row.timings);
  const cost = stages.reduce((a, [, t]) => a + (t.cost ?? 0), 0);
  const cached = stages.reduce((a, [, t]) => a + (t.cached ?? 0), 0);
  const prompt = stages.reduce((a, [, t]) => a + (t.prompt ?? 0), 0);
  console.log(`\nCOST (billed): $${cost.toFixed(2)} · ${prompt} prompt tokens, ${cached} from cache`);
  for (const [k, t] of stages) if (t.cost) console.log(`  ${k.padEnd(10)} $${t.cost.toFixed(3)} · ${Math.round(t.ms / 1000)} s`);
  fs.writeFileSync('test-season-builder.json', JSON.stringify(s, null, 2));

  // --- score old and new with the same rules ---------------------------------
  const prep = row.prepared!;
  const ctx = {
    horizonWeeks: REQUEST.horizonWeeks, weeksToRace: prep.race.weeksToRace, hasElevation: prep.race.hasElevation,
    raceElevationGainM: prep.race.elevationGainM, vertPerKm: prep.race.vertPerKm, raceDistanceKm: prep.race.distanceKm,
    athlete: prep.athlete,
  };
  const report = (label: string, draft: SeasonDraft | null) => {
    if (!draft) { console.log(`\n${label}: unreadable`); return; }
    const v = checkSeason(draft, ctx);
    const sc = scoreViolations(v);
    console.log(`\n${label}: ${draft.phases.length} phases, ${draft.phases.reduce((a, p) => a + p.weeks, 0)} weeks · ${sc.errors} errors · ${sc.warnings} warnings`);
    for (const x of v) console.log(`  ${x.severity === 'error' ? '✗' : '·'} ${x.week ? `P${x.week} ` : ''}[${x.rule}] ${x.message}`);
  };
  report('STAGED season', s);
  const { data: active } = await supabase.from('macro_plans').select('*').eq('user_id', userId).eq('status', 'active').maybeSingle();
  if (active) report(`ACTIVE season (single-call, ${String(active.created_at).slice(0, 10)}, ${active.horizon_weeks} wk horizon)`,
    normalizeSeason({ ...active, decisions: [] }, active.goal_name).season);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--score') continue;
    const raw = JSON.parse(fs.readFileSync(argv[i + 1], 'utf8'));
    report(`SINGLE-CALL season (${argv[i + 1]})`, normalizeSeason(raw, REQUEST.goalName).season);
  }

  if (!argv.includes('--phase1')) return;

  // --- phase 1 from the brief -------------------------------------------------
  const { phaseKpiStatuses } = await import('../lib/coach/season-status');
  const { checkPlan } = await import('../lib/coach/plan-builder/checks');
  const { planStartSunday } = await import('../lib/coach/plan-builder/dates');
  const { userDateStr } = await import('../lib/utils/user-time');
  const { parseTrainingDays } = await import('../lib/coach/training-state');
  const { data: profile } = await supabase.from('athlete_profile').select('training_days').eq('user_id', userId).maybeSingle();
  const { data: temp, error } = await supabase.from('macro_plans').insert({
    user_id: userId, goal_name: s.goal_name, race_date: REQUEST.raceDate, race_distance_km: REQUEST.raceDistanceKm,
    race_elevation_gain_m: REQUEST.raceElevationGainM, terrain_access: REQUEST.terrainAccess, horizon_weeks: REQUEST.horizonWeeks,
    phases: s.phases, rationale: s.rationale, status: 'superseded', revision: 0,
    start_date: planStartSunday(userDateStr()),
  }).select('id').single();
  if (error || !temp) { console.error('could not create the temporary season:', error?.message); return; }
  console.log(`
=== PHASE 1 (temporary season ${temp.id}, status superseded) ===`);
  try {
    const p1 = s.phases[0];
    const days = parseTrainingDays(profile?.training_days) ?? ['Sunday', 'Monday', 'Wednesday', 'Friday'];
    let b = await createBuild(userId, {
      planType: 'Trail / Mountain', durationWeeks: p1.weeks, runsPerWeek: days.length, trainingDays: days,
      macroPlanId: temp.id, phaseNumber: 1, targetRace: s.goal_name, raceDate: REQUEST.raceDate,
      raceDistanceKm: REQUEST.raceDistanceKm, raceElevationGainM: REQUEST.raceElevationGainM, terrainAccess: REQUEST.terrainAccess,
    } as never, { dryRun: true });
    const t1 = Date.now();
    while (b.stage !== 'done' && b.stage !== 'failed') {
      const from = b.stage; const st = Date.now();
      ({ row: b } = await advance(userId, b.id));
      console.log(`  ${from.padEnd(14)} ${((Date.now() - st) / 1000).toFixed(0).padStart(4)} s → ${b.stage}${b.error ? `  (${b.error})` : ''}`);
    }
    console.log(`phase 1 build: ${((Date.now() - t1) / 1000).toFixed(0)} s · ${b.stage}`);
    const brief = b.prepared?.research.macroText.includes("HEAD COACH'S BRIEF FOR PHASE 1");
    console.log(`brief reached the builder: ${brief} · phase ranges: ${JSON.stringify(b.prepared?.research.phaseRanges)}`);
    if (b.weeks) {
      const v = checkPlan(b.weeks, { expectedWeeks: p1.weeks, allowedDays: days, runsPerWeek: days.length, hasElevation: true, hasRace: false, phaseRanges: b.prepared!.research.phaseRanges });
      console.log(`phase-range / rule errors in the final phase plan: ${v.filter((x) => x.severity === 'error').length}`, JSON.stringify(scoreViolations(v).byRule));
      console.log('weeks:', b.weeks.map((w) => `${w.week_number}:${w.total_km}km/${w.total_elevation_gain_m ?? '-'}m`).join(' '));
    }
    for (const r of b.reviews) console.log(`review ${r.round}: ${r.verdict} — ${r.summary.slice(0, 300)}`);
    const pc = Object.values(b.timings).reduce((a, t) => a + (t.cost ?? 0), 0);
    console.log(`phase 1 cost (billed): $${pc.toFixed(2)}`);

    // KPI evaluator on his REAL data (last 8 weeks as if the phase had started then).
    const since = new Date(Date.now() - 56 * 86_400_000).toISOString().slice(0, 10);
    const st = await phaseKpiStatuses(userId, p1, since);
    console.log(`
KPI evaluator on real data since ${since}:`);
    for (const k of st) console.log(`  ${k.met ? '✓' : k.current === null ? '?' : '✗'} ${k.kpi.label}: ${k.current ?? 'not measured'} (target ${k.kpi.comparator === 'gte' ? '≥' : '≤'} ${k.kpi.target}) — ${k.detail}`);
  } finally {
    await supabase.from('macro_plans').delete().eq('id', temp.id).eq('status', 'superseded');
    console.log(`temporary season ${temp.id} deleted`);
  }
})();
