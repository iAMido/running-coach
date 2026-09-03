import * as dotenv from 'dotenv';
const argv = process.argv.slice(2);
const i = argv.indexOf('--env');
dotenv.config({ path: i >= 0 ? argv[i + 1] : '.env.local' });
/**
 * Print how selective each similarity threshold is against the REAL corpus.
 *
 * Exists because BOOK_MATCH_THRESHOLD shipped at 0.7 for the life of the
 * feature and returned zero results for every query ever made — the number was
 * chosen, never measured, and the failure was invisible because an empty book
 * layer looks exactly like a quiet one.
 *
 * Re-run this whenever the embedding model or the corpus changes; the right
 * threshold is a property of both, not a universal.
 *
 * Usage: bunx tsx scripts/measure-rag-thresholds.ts --env "<path to .env.local>"
 */
async function main() {
  const { supabase } = await import('../lib/db/supabase');
  const { generateEmbedding } = await import('../lib/rag/embeddings');
  const q = 'Create a 12-week trail plan for a 21K with 1300m of climbing';
  const { embedding } = await generateEmbedding(q);
  // How selective is each threshold across the WHOLE corpus, not just top-10?
  for (const t of [0.3, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7]) {
    const { data, error } = await supabase.rpc('match_instructions', {
      query_embedding: embedding, match_threshold: t, match_count: 2000,
    });
    if (error) { console.log(t, 'ERROR', error.message); continue; }
    const n = (data as unknown[]).length;
    console.log(`threshold ${t.toFixed(2)} -> ${n} of 1452 chunks (${(n/1452*100).toFixed(1)}%)`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
