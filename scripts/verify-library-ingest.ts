/**
 * End-to-end check of the Coach Library book upload (lib/library/ingest.ts),
 * using the same direct-to-Storage upload the browser uses.
 *
 *   bunx tsx scripts/verify-library-ingest.ts --env .env.local --pdf "<path to a book PDF>"
 *
 * 1. Uploads the PDF through a signed upload URL (PUT, like the page).
 * 2. Runs the pipeline normally — a book already in the library must stop at
 *    the duplicate check and leave nothing behind.
 * 3. Runs it again with duplicates allowed, through every stage and the
 *    retrieval check, prints what the AI read out of the book, then DELETES
 *    that test copy so the library is unchanged.
 */
import * as dotenv from 'dotenv';
const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
dotenv.config({ path: flag('--env') ?? '.env.local' });

(async () => {
  const fs = await import('fs');
  const { randomUUID } = await import('crypto');
  const { supabase } = await import('../lib/db/supabase');
  const { BUCKET, createIngest, advanceIngest, userFolder } = await import('../lib/library/ingest');
  const pdfPath = flag('--pdf');
  if (!pdfPath) throw new Error('--pdf required');
  const { data: prof } = await supabase.from('athlete_profile').select('user_id').limit(1).maybeSingle();
  const userId = (prof as { user_id: string }).user_id;
  const bytes = fs.readFileSync(pdfPath);
  const filename = pdfPath.split(/[\/]/).pop()!;

  const upload = async () => {
    const path = `${userFolder(userId)}/${randomUUID()}.pdf`;
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw new Error(`signed url: ${error?.message}`);
    const t = Date.now();
    const res = await fetch(data.signedUrl, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: bytes });
    console.log(`upload ${(bytes.length / 1e6).toFixed(1)} MB via signed URL: HTTP ${res.status} in ${((Date.now() - t) / 1000).toFixed(1)} s`);
    if (!res.ok) throw new Error(await res.text());
    return path;
  };

  const run = async (label: string) => {
    let row = await createIngest(userId, filename, await upload());
    while (row.stage !== 'done' && row.stage !== 'failed') {
      const from = row.stage; const t = Date.now();
      ({ row } = await advanceIngest(userId, row.id));
      console.log(`  [${label}] ${from.padEnd(10)} ${((Date.now() - t) / 1000).toFixed(0).padStart(4)} s → ${row.stage}${row.stage === 'chunked' || row.stage === 'embedded' ? ` (${row.chunks_done}/${row.chunks_total} sections)` : ''}${row.error ? `  ${row.error}` : ''}`);
    }
    return row;
  };

  console.log('\n1) normal upload of a book already in the library:');
  const dup = await run('normal');
  const { count: leftover } = await supabase.from('coaching_books').select('id', { count: 'exact', head: true }).contains('raw_metadata', { ingest_id: dup.id });
  console.log(`   → ${dup.stage}: ${dup.error} · book rows left behind: ${leftover ?? 0}`);

  console.log('\n2) full pipeline (duplicates allowed for the test):');
  process.env.LIBRARY_INGEST_ALLOW_DUPLICATES = '1';
  const full = await run('full');
  if (full.meta) {
    console.log(`\n   title: ${full.meta.title}\n   author: ${full.meta.author} (${full.meta.year ?? '?'})\n   methodology: ${full.meta.methodology} · level ${full.meta.level}\n   description: ${full.meta.description}\n   tags: ${full.meta.tags.join(', ')}\n   focus: ${full.meta.focus_areas.join('; ')}\n   phases: ${full.meta.phases.join(' → ')}`);
  }
  console.log(`   pages ${full.pages} · sections ${full.chunks_done}/${full.chunks_total}`);
  for (const c of full.check_result ?? []) console.log(`   retrieval check ${c.found ? '✓' : '✗'} ${c.question}`);
  if (full.book_id) {
    const { data: sample } = await supabase.from('book_instructions').select('chapter_number, chapter_title, applies_to_phase, applies_to_workout_type').eq('book_id', full.book_id).not('chapter_title', 'is', null).limit(5);
    console.log('   chapter sample:', JSON.stringify(sample));
    await supabase.from('book_instructions').delete().eq('book_id', full.book_id);
    await supabase.from('coaching_books').delete().eq('id', full.book_id);
    console.log(`   test copy deleted (book ${full.book_id})`);
  }
  const { data: files } = await supabase.storage.from(BUCKET).list(userFolder(userId));
  console.log(`   files left in storage for this user: ${files?.length ?? 0}`);
})();
