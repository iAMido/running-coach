// Supabase Edge Function: backfill missing embeddings for runcoach.book_instructions.
// One-shot admin job. Reads rows with embedding IS NULL, generates OpenAI vectors
// (text-embedding-3-small, 1536d), and updates rows.
//
// Required Supabase secret: OPENAI_API_KEY
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected by Supabase.
//
// Invocation: POST with no body. Optional ?dryRun=1 to count without writing.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2';

const OPENAI_URL = 'https://api.openai.com/v1/embeddings';
const MODEL = 'text-embedding-3-small';
const DIMENSIONS = 1536;
const BATCH_SIZE = 50;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const dryRun = url.searchParams.get('dryRun') === '1';

  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!openaiKey) {
    return json({ ok: false, error: 'OPENAI_API_KEY not set in Supabase secrets' }, 500);
  }
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: 'SUPABASE_URL or SERVICE_ROLE_KEY missing' }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    db: { schema: 'runcoach' },
  });

  const { data, error } = await supabase
    .from('book_instructions')
    .select('id, content, chapter_title, section_title')
    .is('embedding', null);

  if (error) return json({ ok: false, error: error.message }, 500);

  const rows = (data || []) as Array<{
    id: string;
    content: string;
    chapter_title: string | null;
    section_title: string | null;
  }>;

  if (rows.length === 0) {
    return json({ ok: true, message: 'Nothing to backfill', updated: 0, remaining: 0 });
  }

  if (dryRun) {
    return json({ ok: true, dryRun: true, would_embed: rows.length, sample_ids: rows.slice(0, 3).map(r => r.id) });
  }

  // Build inputs with topical heading prepended so vectors carry context
  const inputs = rows.map(r => {
    const head = [r.chapter_title, r.section_title].filter(Boolean).join(' — ');
    const clean = (r.content || '').replace(/\s+/g, ' ').trim().slice(0, 24000); // ~6k tokens cap
    return head ? `${head}\n\n${clean}` : clean;
  });

  let updated = 0;
  let failed = 0;
  const errors: string[] = [];

  // Embed in batches
  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    const slice = inputs.slice(i, i + BATCH_SIZE);
    const rowSlice = rows.slice(i, i + BATCH_SIZE);

    const r = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, input: slice, dimensions: DIMENSIONS }),
    });

    if (!r.ok) {
      const body = await r.text();
      return json({ ok: false, error: `OpenAI API ${r.status}: ${body}`, updated, failed }, 502);
    }

    const data = (await r.json()) as { data: Array<{ embedding: number[] }>; usage?: { total_tokens?: number } };
    const perTokens = data.usage?.total_tokens ? Math.ceil(data.usage.total_tokens / slice.length) : null;

    for (let j = 0; j < data.data.length; j++) {
      const row = rowSlice[j];
      const vec = data.data[j].embedding;
      const vecLiteral = `[${vec.join(',')}]`;

      const { error: upErr } = await supabase
        .from('book_instructions')
        .update({
          embedding: vecLiteral,
          ...(perTokens != null ? { token_count: perTokens } : {}),
        })
        .eq('id', row.id);

      if (upErr) {
        failed++;
        errors.push(`${row.id}: ${upErr.message}`);
      } else {
        updated++;
      }
    }
  }

  return json({
    ok: true,
    total_found: rows.length,
    updated,
    failed,
    errors: errors.slice(0, 5),
  });
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
