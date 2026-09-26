/**
 * Add (or replace) a book in the coaches' library from the command line,
 * through the SAME pipeline as the Coach Library page (lib/library/ingest.ts):
 * signed-URL upload to Storage, then every stage, then the retrieval check.
 *
 *   bunx tsx scripts/library-upload.ts --env .env.local --file "<book.pdf|book.txt>" [--replaces "<part of an existing title>"]
 *
 * With --replaces the existing book is removed only after the new one is fully
 * embedded and checked; a snapshot of it stays on the library_ingests row.
 * Use a .txt for a scanned book (OCR it first) — the page's 50 MB limit and a
 * missing text layer both stop a PDF like that.
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
  const file = flag('--file');
  if (!file) throw new Error('--file required');
  const filename = file.split(/[\/]/).pop()!;
  const ext = filename.match(/\.(pdf|txt)$/i)?.[1]?.toLowerCase();
  if (!ext) throw new Error('a .pdf or .txt file is required');
  const { data: prof } = await supabase.from('athlete_profile').select('user_id').limit(1).maybeSingle();
  const userId = (prof as { user_id: string }).user_id;

  let replaceId: string | undefined;
  const replaces = flag('--replaces');
  if (replaces) {
    const { data } = await supabase.from('coaching_books').select('id, title').ilike('title', `%${replaces}%`);
    if (!data || data.length !== 1) throw new Error(`--replaces "${replaces}" must match exactly one book (matched ${data?.length ?? 0})`);
    replaceId = data[0].id;
    console.log(`replaces: ${data[0].title}`);
  }

  const path = `${userFolder(userId)}/${randomUUID()}.${ext}`;
  const { data: signed, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !signed) throw new Error(`signed url: ${error?.message}`);
  const body = fs.readFileSync(file);
  const put = await fetch(signed.signedUrl, { method: 'PUT', headers: { 'Content-Type': ext === 'txt' ? 'text/plain' : 'application/pdf' }, body });
  if (!put.ok) throw new Error(`upload failed: ${put.status} ${await put.text()}`);
  console.log(`uploaded ${filename} (${(body.length / 1e6).toFixed(1)} MB)`);

  let row = await createIngest(userId, filename, path, replaceId);
  while (row.stage !== 'done' && row.stage !== 'failed') {
    const from = row.stage; const t = Date.now();
    ({ row } = await advanceIngest(userId, row.id));
    console.log(`  ${from.padEnd(10)} ${((Date.now() - t) / 1000).toFixed(0).padStart(4)} s → ${row.stage}${row.chunks_total ? ` (${row.chunks_done}/${row.chunks_total})` : ''}${row.error ? `  ${row.error}` : ''}`);
  }
  if (row.stage === 'done' && row.meta) {
    console.log(`  title: ${row.meta.title}\n  author: ${row.meta.author} · methodology: ${row.meta.methodology} · ${row.meta.level}\n  description: ${row.meta.description}\n  tags: ${row.meta.tags.join(', ')}`);
    for (const c of row.check_result ?? []) console.log(`  check ${c.found ? '✓' : '·'} ${c.question}`);
    if (row.replaced) console.log(`  replaced: ${(row.replaced as { book: { title: string } }).book.title} (${(row.replaced as { sections: unknown[] }).sections.length} old sections)`);
  }
})();
