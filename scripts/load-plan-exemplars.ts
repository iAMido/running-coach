/**
 * Load expert training plans as exemplars.
 *
 * For each JSON export in a directory:
 *   1. distil it (lib/coach/plan-exemplars.ts) and upsert into
 *      runcoach.plan_exemplars — what plan generation selects from;
 *   2. embed two purpose-built chunks into book_instructions under a
 *      synthetic "Expert Plan Library" book — what Ask Coach retrieves from:
 *        - structure & reasoning: phases, loading, volume/climb, coach's notes
 *        - strength programme:    per-phase frequency and exercises
 *
 * Two chunks rather than the whole rendering, because they answer different
 * questions. "How do trail plans periodise?" and "how should strength progress
 * for a mountain race?" should each land on the text that answers them, not on
 * a 6 KB blob that answers both and neither.
 *
 * DRY RUN BY DEFAULT — prints what would be written. `--commit` writes.
 * Idempotent: exemplars upsert on source_key; library chunks are replaced.
 *
 * Usage:
 *   bunx tsx scripts/load-plan-exemplars.ts <dir> --env "<path to .env.local>"
 *   bunx tsx scripts/load-plan-exemplars.ts <dir> --env "<...>" --commit
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

const argv = process.argv.slice(2);
const envIdx = argv.indexOf('--env');
dotenv.config({ path: envIdx >= 0 ? argv[envIdx + 1] : '.env.local' });
const COMMIT = argv.includes('--commit');
const dir = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--env');

const LIBRARY_TITLE = 'Expert Plan Library';

async function main() {
  if (!dir || !fs.existsSync(dir)) {
    console.error('Usage: load-plan-exemplars.ts <dir-of-plan-json> --env <.env.local> [--commit]');
    process.exit(1);
  }
  const { supabase } = await import('../lib/db/supabase');
  const { generateEmbedding } = await import('../lib/rag/embeddings');
  const { distillPlan, renderExemplar } = await import('../lib/coach/plan-exemplars');
  type Exemplar = ReturnType<typeof distillPlan>;

  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json')).sort();
  console.log(`\n${COMMIT ? 'COMMIT' : 'DRY RUN'} — ${files.length} plan files in ${dir}\n`);

  const exemplars: Exemplar[] = [];
  for (const f of files) {
    const key = path.basename(f, '.json').replace(/^plan-/, '');
    const ex = distillPlan(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), key);
    exemplars.push(ex);
    const strengthWeeks = ex.representativeWeeks.flatMap((w) => w.sessions).filter((s) => s.sport === 'strength');
    const emptyStrength = strengthWeeks.filter((s) => s.strength.length === 0 && s.strengthSource !== 'notes').length;
    console.log(
      `  ${ex.kind.padEnd(14)} ${ex.name.slice(0, 44).padEnd(44)} ${String(ex.weeks).padStart(2)}w ` +
        `notes ${ex.coachingNotes.length} · strength sessions in sample weeks ${strengthWeeks.length}` +
        (emptyStrength ? `  ⚠ ${emptyStrength} WITH NO EXERCISES` : ''),
    );
  }

  // Chunks for Ask Coach.
  const chunks = exemplars.flatMap((ex) => chunksFor(ex));
  console.log(`\nlibrary chunks to embed: ${chunks.length}`);

  if (!COMMIT) {
    console.log('\n(dry run — pass --commit to write)');
    return;
  }

  // 1. Exemplars.
  for (const ex of exemplars) {
    const { error } = await supabase.from('plan_exemplars').upsert(
      {
        source_key: ex.sourceKey,
        name: ex.name,
        description: ex.description,
        kind: ex.kind,
        tags: ex.tags,
        weeks: ex.weeks,
        goal_distance_km: ex.goal.distanceKm,
        goal_elevation_gain_m: ex.goal.elevationGainM,
        goal_elevation_loss_m: ex.goal.elevationLossM,
        exemplar: ex,
        rendered: renderExemplar(ex),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'source_key' },
    );
    if (error) throw new Error(`upsert ${ex.sourceKey}: ${error.message}`);
  }
  console.log(`upserted ${exemplars.length} exemplars`);

  // 2. The synthetic library book, and its chunks (replaced wholesale).
  let { data: book } = await supabase.from('coaching_books').select('id').eq('title', LIBRARY_TITLE).maybeSingle();
  if (!book) {
    const { data, error } = await supabase
      .from('coaching_books')
      .insert({
        title: LIBRARY_TITLE,
        author: 'Coaching platform library plans (supplied by the athlete, 2026-09-26)',
        methodology: 'Plan Library',
        level: 'all',
        tags: ['plan structure', 'periodization', 'strength', 'trail', 'threshold'],
        phases: ['All'],
        focus_areas: ['how expert plans are structured', 'loading rhythm', 'strength placement and progression'],
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`create library book: ${error?.message}`);
    book = data;
  }
  const bookId = (book as { id: string }).id;
  await supabase.from('book_instructions').delete().eq('book_id', bookId);

  let written = 0;
  for (const c of chunks) {
    const { embedding, error: embErr } = await generateEmbedding(c.content);
    if (embErr || !embedding.length) {
      console.error(`  embed failed: ${c.title}: ${embErr}`);
      continue;
    }
    const { error } = await supabase.from('book_instructions').insert({
      book_id: bookId,
      chapter_title: c.title,
      section_title: c.section,
      content: c.content,
      // Applies everywhere: an untagged chunk is unrestricted by the phase
      // filter since 20260926_book_filter_include_untagged.
      applies_to_phase: null,
      applies_to_workout_type: c.section === 'strength programme' ? 'Strength' : null,
      embedding,
      token_count: Math.ceil(c.content.length / 4),
    });
    if (error) console.error(`  insert failed: ${c.title}: ${error.message}`);
    else written++;
  }
  console.log(`embedded ${written}/${chunks.length} library chunks under "${LIBRARY_TITLE}"`);
}

/** The two question-shaped chunks for one plan. */
function chunksFor(ex: {
  name: string; description: string; kind: string; weeks: number; tags: string[];
  goal: { distanceKm: number | null; elevationGainM: number | null; elevationLossM: number | null };
  phases: { name: string; fromWeek: number; toWeek: number }[];
  kmByWeek: (number | null)[]; elevationByWeek: number[]; recoveryWeeks: number[];
  loadingPattern: string | null; runsPerWeek: number;
  strengthSessionsPerWeekByPhase: Record<string, number>;
  coachingNotes: { phase: string; weeks: string; recovery: boolean; note: string }[];
  representativeWeeks: { phase: string; week: number; sessions: { sport: string; name: string | null; notes: string | null; strength: { exercise: string; sets: number | null; reps: string | null; seconds: number | null; load: string | null; unilateral: boolean }[] }[] }[];
}): { title: string; section: string; content: string }[] {
  const out: { title: string; section: string; content: string }[] = [];
  const profile = [
    ex.goal.distanceKm ? `${ex.goal.distanceKm} km` : null,
    ex.goal.elevationGainM ? `+${ex.goal.elevationGainM}/-${ex.goal.elevationLossM ?? '?'} m` : null,
  ].filter(Boolean).join(', ');

  const km = ex.kmByWeek.filter((k): k is number => typeof k === 'number' && k > 0);
  const structure = [
    `Expert plan: ${ex.name} (${ex.weeks} weeks${profile ? `, ${profile}` : ''}). Type: ${ex.kind}. Tags: ${ex.tags.join(', ')}.`,
    ex.description ? `Intent: ${ex.description}` : '',
    `Phase structure: ${ex.phases.map((p) => `${p.name} weeks ${p.fromWeek}-${p.toWeek}`).join('; ')}.`,
    km.length ? `Weekly volume rises from ${km[0]} to a peak of ${Math.max(...km)} km.` : '',
    ex.loadingPattern ? `Loading follows a ${ex.loadingPattern} rhythm.` : '',
    ex.recoveryWeeks.length ? `Recovery/down weeks: ${ex.recoveryWeeks.join(', ')}.` : '',
    ex.elevationByWeek.some((m) => m > 0)
      ? `Weekly climb progresses ${ex.elevationByWeek.filter((m) => m > 0).slice(0, 1)} → ${Math.max(...ex.elevationByWeek)} m.`
      : '',
    `Runs per week about ${ex.runsPerWeek}.`,
    ex.coachingNotes.length
      ? `The coach's reasoning, in order: ${ex.coachingNotes.map((n) => `[${n.recovery ? 'recovery ' : ''}${n.phase}, weeks ${n.weeks}] ${n.note}`).join(' ')}`
      : '',
  ].filter(Boolean).join('\n');
  out.push({ title: ex.name, section: 'structure and reasoning', content: structure });

  const strengthLines: string[] = [];
  for (const w of ex.representativeWeeks) {
    const sessions = w.sessions.filter((s) => s.sport === 'strength');
    if (!sessions.length) continue;
    const s = sessions[0];
    const list = s.strength.map((e) =>
      `${e.exercise}${e.unilateral ? ' (each side)' : ''} ${e.seconds ? `${e.sets ?? '?'}x${e.seconds}s` : `${e.sets ?? '?'}x${e.reps ?? '?'}`}${e.load ? ` at ${e.load}` : ''}`,
    ).join('; ');
    strengthLines.push(
      `${w.phase} (week ${w.week}, ${ex.strengthSessionsPerWeekByPhase[w.phase] ?? sessions.length} sessions/week)` +
        `${s.name ? ` — "${s.name}"` : ''}: ${list || '(described in prose)'}${s.notes ? `. Coach's note: ${s.notes}` : ''}`,
    );
  }
  if (strengthLines.length) {
    out.push({
      title: ex.name,
      section: 'strength programme',
      content: `Strength programming in the expert plan "${ex.name}"${profile ? ` (${profile})` : ''}, by phase:\n${strengthLines.join('\n')}`,
    });
  }
  return out;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
