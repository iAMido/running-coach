/**
 * User-resource ingestion + listing.
 *
 * POST: accept athlete material in one of two formats:
 *   - application/json: { title, content, ...metadata } (paste-text path)
 *   - multipart/form-data: file (PDF) + title + metadata fields (file path)
 *   Chunks the text, embeds via OpenAI, writes
 *   runcoach.user_resources + runcoach.user_resource_chunks.
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
import { PDFParse } from 'pdf-parse';

const MAX_BODY_CHARS = 250_000; // ~62k tokens, plenty for a coach handbook
const MAX_PDF_BYTES = 15 * 1024 * 1024; // 15MB

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

interface PostFields {
  title: string;
  content: string;
  description?: string;
  methodology_tags?: string[];
  source_type?: string;
  original_filename?: string;
  applies_to_phase?: string;
  applies_to_workout_type?: string;
}

async function parseJsonBody(request: NextRequest): Promise<PostFields | { error: string }> {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return { error: 'Invalid JSON body' };
  }
  const title = String(body.title || '').trim();
  const content = String(body.content || '').trim();
  if (!title) return { error: 'title required' };
  if (!content) return { error: 'content required' };
  return {
    title,
    content,
    description: typeof body.description === 'string' ? body.description : undefined,
    methodology_tags: Array.isArray(body.methodology_tags) ? body.methodology_tags as string[] : undefined,
    source_type: typeof body.source_type === 'string' ? body.source_type : 'pasted_text',
    original_filename: typeof body.original_filename === 'string' ? body.original_filename : undefined,
    applies_to_phase: typeof body.applies_to_phase === 'string' ? body.applies_to_phase : undefined,
    applies_to_workout_type: typeof body.applies_to_workout_type === 'string' ? body.applies_to_workout_type : undefined,
  };
}

async function parseFormBody(request: NextRequest): Promise<PostFields | { error: string }> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { error: 'Invalid form body' };
  }
  const title = (form.get('title')?.toString() || '').trim();
  if (!title) return { error: 'title required' };

  const file = form.get('file');
  if (!(file instanceof File)) return { error: 'file required' };
  if (file.size > MAX_PDF_BYTES) {
    return { error: `file exceeds ${(MAX_PDF_BYTES / 1024 / 1024).toFixed(0)}MB` };
  }
  const filename = file.name || 'document.pdf';
  const lower = filename.toLowerCase();
  const isPdf = lower.endsWith('.pdf') || file.type === 'application/pdf';
  if (!isPdf) return { error: 'only PDF uploads are supported (.pdf)' };

  let extractedText: string;
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    const parser = new PDFParse({ data: buf });
    try {
      const result = await parser.getText();
      extractedText = (result.text || '').trim();
    } finally {
      await parser.destroy().catch(() => {});
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return { error: `Failed to parse PDF: ${msg}` };
  }

  if (!extractedText) return { error: 'PDF contained no extractable text (scanned image?)' };

  const tagsRaw = form.get('methodology_tags')?.toString() || '';
  const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);

  return {
    title,
    content: extractedText,
    description: form.get('description')?.toString() || undefined,
    methodology_tags: tags.length ? tags : undefined,
    source_type: 'pdf',
    original_filename: filename,
    applies_to_phase: form.get('applies_to_phase')?.toString() || undefined,
    applies_to_workout_type: form.get('applies_to_workout_type')?.toString() || undefined,
  };
}

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (!auth.authenticated || !auth.userId) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500 });
  }

  const contentType = request.headers.get('content-type') || '';
  const parsed = contentType.includes('multipart/form-data')
    ? await parseFormBody(request)
    : await parseJsonBody(request);

  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const body = parsed;
  const title = body.title;
  const content = body.content;
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
