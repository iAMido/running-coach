/**
 * End-to-end DRY RUN of the staged SEASON builder (lib/coach/plan-builder/season.ts):
 * every stage runs for real, the save stage refuses to touch macro_plans.
 *
 * Usage:
 *   bunx tsx scripts/verify-season-builder.ts --env .env.local [--score <season.json>]...
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
})();
