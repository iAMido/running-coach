/**
 * Backfill missing embeddings on runcoach.book_instructions.
 *
 * Some book chunks (notably both Norwegian Method books) were inserted
 * without embeddings, which silently excludes them from pgvector search.
 * The system prompt keeps citing "Norwegian Method principles" but the
 * retriever has been returning nothing from those books.
 *
 * Run from project root: bun run scripts/backfill-embeddings.ts
 *
 * Env required:
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - OPENAI_API_KEY
 */

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { generateEmbeddingsBatch, formatEmbeddingForStorage } from '../lib/rag/embeddings';

// Load .env.local then .env (mirrors how Next loads them)
config({ path: '.env.local' });
config({ path: '.env' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  db: { schema: 'runcoach' },
});

type Row = {
  id: string;
  content: string;
  chapter_title: string | null;
  section_title: string | null;
  book_id: string;
};

async function main() {
  console.log('Looking for unembedded book_instructions...');

  const { data, error } = await supabase
    .from('book_instructions')
    .select('id, content, chapter_title, section_title, book_id')
    .is('embedding', null);

  if (error) {
    console.error('Query failed:', error);
    process.exit(1);
  }

  const rows = (data || []) as Row[];
  if (rows.length === 0) {
    console.log('Nothing to backfill — all chunks already embedded.');
    return;
  }

  console.log(`Found ${rows.length} chunks needing embeddings. Embedding...`);

  // Build inputs: prepend chapter/section titles so vectors carry topical context
  const inputs = rows.map(r => {
    const head = [r.chapter_title, r.section_title].filter(Boolean).join(' — ');
    return head ? `${head}\n\n${r.content}` : r.content;
  });

  const { embeddings, error: embedError } = await generateEmbeddingsBatch(inputs, 50);
  if (embedError) {
    console.error('Embedding batch error:', embedError);
    if (embeddings.length === 0) process.exit(1);
    console.warn(`Partial result: got ${embeddings.length}/${rows.length}; proceeding with what we have.`);
  }

  let updated = 0;
  let failed = 0;

  for (let i = 0; i < embeddings.length; i++) {
    const row = rows[i];
    const vec = embeddings[i].embedding;
    const tokenCount = embeddings[i].tokenCount;

    const { error: upErr } = await supabase
      .from('book_instructions')
      .update({
        embedding: formatEmbeddingForStorage(vec),
        token_count: tokenCount || undefined,
      })
      .eq('id', row.id);

    if (upErr) {
      failed++;
      console.error(`Update failed for ${row.id}:`, upErr.message);
    } else {
      updated++;
    }
  }

  console.log(`Done. Updated: ${updated}. Failed: ${failed}. Remaining unembedded: ${rows.length - updated}.`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
