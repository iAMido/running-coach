/**
 * End-to-end run of the staged plan builder, DRY RUN: every stage runs for
 * real (models, retrieval, checks, reviews) but the save stage refuses to
 * touch training_plans. The build row stays in plan_builds for inspection.
 *
 * Usage:
 *   bunx tsx scripts/verify-plan-builder.ts --env .env.local [--out test-plan-builder.json]
 *
 * Same request as scripts/verify-plan-generation.ts (12-week trail block for
 * the 21K / 1300 m race) so the two generators can be scored side by side
 * with scripts/score-plan.ts.
 */
import * as dotenv from 'dotenv';

const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
dotenv.config({ path: flag('--env') ?? '.env.local' });

(async () => {
  const fs = await import('fs');
  const { supabase } = await import('../lib/db/supabase');
  const { createBuild, advance, STAGE_LABELS } = await import('../lib/coach/plan-builder/runner');
  const { scoreViolations } = await import('../lib/coach/plan-builder/checks');

  const { data: prof } = await supabase.from('athlete_profile').select('user_id').limit(1).maybeSingle();
  const userId = (prof as { user_id: string }).user_id;

  const t0 = Date.now();
  let { row } = { row: await createBuild(userId, {
    planType: 'Trail / Mountain', durationWeeks: 12, runsPerWeek: 4,
    trainingDays: ['Sunday', 'Monday', 'Wednesday', 'Friday'], trainingDayNotes: 'Monday quality, Friday long',
    raceDistanceKm: 21, raceElevationGainM: 1300, targetRace: 'Zermatt-style mountain half marathon', raceDate: '2027-07-03',
    terrainAccess: 'Flat roads locally; Jerusalem-corridor trails 30-45 min drive (Southern Sorek 47 m/km, Nahal Kisalon 21km at 26 m/km); gym stairs, incline treadmill and stair climber.',
  }, { dryRun: true }) };
  console.log(`build ${row.id}`);

  while (row.stage !== 'done' && row.stage !== 'failed') {
    const from = row.stage;
    const s = Date.now();
    ({ row } = await advance(userId, row.id));
    console.log(`  ${STAGE_LABELS[from].padEnd(40)} ${((Date.now() - s) / 1000).toFixed(0).padStart(4)} s → ${row.stage}${row.error ? `  (${row.error})` : ''}`);
  }
  console.log(`total ${((Date.now() - t0) / 1000).toFixed(0)} s · stage ${row.stage}`);
  if (row.stage === 'failed') process.exit(1);

  console.log('\nOUTLINE:', row.outline?.plan_name);
  console.log('  rationale:', row.outline?.rationale);
  for (const p of row.outline?.phases ?? []) console.log(`  ${p.name} W${p.start_week}-${p.end_week}: ${p.purpose}`);
  console.log('  targets:', row.outline?.weeks.map((w) => `${w.week}:${w.total_km}km/${w.total_elevation_gain_m ?? '-'}m${w.is_recovery ? 'R' : ''}`).join(' '));
  console.log('  strength library:', Object.keys(row.outline?.strength_sessions ?? {}).join(', '));
  console.log('  decisions:', row.outline?.decisions.join(' | '));
  if (row.outline?.repaired?.length) console.log('  repaired:', row.outline.repaired.join('; '));
  console.log('\nRESEARCH:', row.prepared?.research.needs.map((n) => `${n.need} ← ${n.sources.join(', ') || 'nothing'}`).join('\n          '));
  console.log('ATHLETE NOTES:', row.prepared?.athlete.dayMismatch ?? '-', '|', row.prepared?.race.durationNote ?? '-');

  const s = scoreViolations(row.checks?.violations ?? []);
  console.log(`\nCHECKS after repair: ${s.errors} errors · ${s.warnings} warnings ·`, JSON.stringify(s.byRule));
  for (const r of row.checks?.repairs ?? []) console.log(`  repair round ${r.round}: weeks ${r.weeks.join(',')} · errors ${r.errorsBefore} → ${r.errorsAfter}`);
  for (const v of (row.checks?.violations ?? []).filter((x) => x.severity === 'error')) console.log(`  ✗ W${v.week} ${v.day ?? ''} [${v.rule}] ${v.message}`);
  for (const r of row.reviews) {
    console.log(`\nREVIEW ${r.round}: ${r.verdict}${r.fixApplied ? ' (fix applied)' : ''} — ${r.summary}`);
    for (const i of r.issues) console.log(`  ${i.severity === 'must_fix' ? '!' : '·'} [${i.source}] W${i.weeks.join(',')} ${i.problem}\n      → ${i.fix}`);
  }
  console.log('\nTIMINGS:', JSON.stringify(row.timings));

  const out = flag('--out') ?? 'test-plan-builder.json';
  fs.writeFileSync(out, JSON.stringify({ weeks: row.weeks, strength_sessions: row.outline?.strength_sessions, outline: row.outline }, null, 2));
  console.log(`\nwrote ${out}`);
})();
