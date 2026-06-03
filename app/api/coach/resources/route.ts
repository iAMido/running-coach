/**
 * User-resource ingestion + listing.
 *
 * POST: accept { title, content, ...metadata } from the athlete, chunk it,
 *       embed each chunk via OpenAI, and write rows into
 *       runcoach.user_resources + runcoach.user_resource_chunks.
 * GET:  list active resources with chunk + token counts for the UI.
 *
 * The retriever (lib/rag/user-resource-retriever.ts) surfaces chunks back
 * into the AI prompt alongside the methodology books via pgvector.
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/db/supabase';
import { getAuthenticatedUser } from '@/lib/auth/get-user';
import { generateEmbeddingsBatch, formatEmbeddingForStorage } from '@/lib/rag/embeddings';
import { chunkText } from '@/lib/rag/chunker';

const MAX_BODY_CHARS = 250_000; // ~62k tokens, plenty for a coach handbook

export async function GET() {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('user_resources')
    .select('id, title, source_type, description, methodology_tags, chunk_count, total_tokens, status, created_at')
    .eq('user_id', auth.userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ resources: data || [] });
}

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500 });
  }

  let body: {
    title?: string;
    content?: string;
    description?: string;
    methodology_tags?: string[];
    source_type?: string;
    original_filename?: string;
    applies_to_phase?: string;
    applies_to_workout_type?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const title = (body.title || '').trim();
  const content = (body.content || '').trim();
  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 });
  if (!content) return NextResponse.json({ error: 'content required' }, { status: 400 });
  if (content.length > MAX_BODY_CHARS) {
    return NextResponse.json({ error: `content exceeds ${MAX_BODY_CHARS} chars` }, { status: 413 });
  }

  // 1. Insert the parent resource row (chunk_count / total_tokens patched later)
  const { data: resource, error: insertError } = await supabase
    .from('user_resources')
    .insert({
      user_id: auth.userId,
      title,
      source_type: body.source_type || 'pasted_text',
      original_filename: body.original_filename || null,
      description: body.description || null,
      methodology_tags: body.methodology_tags || null,
      applies_to_phase: body.applies_to_phase || null,
      applies_to_workout_type: body.applies_to_workout_type || null,
    })
    .select('id')
    .single();

  if (insertError || !resource) {
    return NextResponse.json({ error: insertError?.message || 'insert failed' }, { status: 500 });
  }

  // 2. Chunk + embed
  const chunks = chunkText(content);
  if (chunks.length === 0) {
    // No usable text — back out the parent row.
    await supabase.from('user_resources').delete().eq('id', resource.id);
    return NextResponse.json({ error: 'No usable text after chunking' }, { status: 400 });
  }

  const inputs = chunks.map(c => {
    const head = c.sectionTitle ? `${title} — ${c.sectionTitle}` : title;
    return `${head}\n\n${c.content}`;
  });

  const { embeddings, error: embedError } = await generateEmbeddingsBatch(inputs, 50);
  if (embedError && embeddings.length === 0) {
    await supabase.from('user_resources').delete().eq('id', resource.id);
    return NextResponse.json({ error: `Embedding failed: ${embedError}` }, { status: 502 });
  }

  // 3. Insert chunks
  const chunkRows = chunks.slice(0, embeddings.length).map((c, i) => ({
    resource_id: resource.id,
    user_id: auth.userId,
    chunk_index: c.index,
    section_title: c.sectionTitle || null,
    content: c.content,
    embedding: formatEmbeddingForStorage(embeddings[i].embedding),
    token_count: embeddings[i].tokenCount || c.tokenEstimate,
  }));

  const { error: chunkError } = await supabase.from('user_resource_chunks').insert(chunkRows);
  if (chunkError) {
    await supabase.from('user_resources').delete().eq('id', resource.id);
    return NextResponse.json({ error: chunkError.message }, { status: 500 });
  }

  // 4. Patch counts on the parent row
  const totalTokens = embeddings.reduce((s, e) => s + (e.tokenCount || 0), 0);
  await supabase
    .from('user_resources')
    .update({
      chunk_count: chunkRows.length,
      total_tokens: totalTokens,
      updated_at: new Date().toISOString(),
    })
    .eq('id', resource.id);

  return NextResponse.json({
    resource: {
      id: resource.id,
      title,
      chunk_count: chunkRows.length,
      total_tokens: totalTokens,
    },
    warning: embedError && embeddings.length < chunks.length
      ? `Partial embedding: ${embeddings.length}/${chunks.length}`
      : undefined,
  });
}
