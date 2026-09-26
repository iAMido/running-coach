/**
 * Upload a book A to Z — the Coach Library's book pipeline. One stage per
 * request (resumable), like the staged plan builder:
 *
 *   uploaded  → extract the text from the PDF in Storage
 *   extracted → the AI reads the opening + body samples: title, author,
 *               description, methodology, tags, focus areas, phases, level
 *   analyzed  → book row + chapter-aware, tagged sections
 *   chunked   → embed sections into book_instructions (batched, may repeat)
 *   embedded  → retrieval check: do searches on the book's own topics find it?
 *   done      → source files removed from Storage
 *
 * Writes into the same coaching_books / book_instructions corpus the coaches
 * search, so an uploaded book is used exactly like the loaded ones. A failure
 * after the book row exists removes the row and its sections — never half a
 * book in the library.
 */

import { createHash } from 'crypto';
import { supabase } from '@/lib/db/supabase';
import { callOpenRouter } from '@/lib/ai/openrouter';
import { MODEL_FOR } from '@/lib/ai/model-registry';
import { extractJson } from '@/lib/coach/plan-output';
import { formatEmbeddingForStorage, generateEmbeddingsBatch } from '@/lib/rag/embeddings';
import { retrieveBookContext } from '@/lib/rag/book-retriever';
import { buildChunks, findDuplicateTitle, METADATA_PROMPT, metadataSample, parseBookMeta, type BookChunk, type BookMeta } from '@/lib/rag/book-ingest';

export const BUCKET = 'coach-library';
/** Books are 6-11 MB; this leaves room for large textbooks. */
export const MAX_BOOK_BYTES = 50 * 1024 * 1024;
const CLAIM_MS = 290_000;
/** Stop embedding and hand back to a new request past this — well inside 300 s. */
const EMBED_BUDGET_MS = 180_000;
/** Below this, the PDF is almost certainly scanned images with no text layer. */
const MIN_TEXT_CHARS = 5_000;

export type IngestStage = 'uploaded' | 'extracted' | 'analyzed' | 'chunked' | 'embedded' | 'done' | 'failed';

export interface IngestRow {
  id: string;
  user_id: string;
  stage: IngestStage;
  filename: string;
  storage_path: string;
  pages: number | null;
  text_chars: number | null;
  meta: BookMeta | null;
  chunks_total: number | null;
  chunks_done: number;
  book_id: string | null;
  check_result: { question: string; found: boolean }[] | null;
  /** The existing book this upload replaces (e.g. a summary by the full book). */
  replace_book_id: string | null;
  /** Snapshot of the replaced book and its sections, taken just before it was removed. */
  replaced: Record<string, unknown> | null;
  error: string | null;
  timings: Record<string, number>;
  running_until: string | null;
  created_at: string;
  updated_at: string;
}

export const INGEST_LABELS: Record<IngestStage, string> = {
  uploaded: 'Reading the PDF',
  extracted: 'AI reading the book: title, author, description, tags',
  analyzed: 'Splitting into chapters and sections',
  chunked: 'Embedding sections into the library',
  embedded: 'Checking the coaches can find it',
  done: 'Done',
  failed: 'Failed',
};

/** Per-user upload folder, without putting the account id (an email) in the path. */
export function userFolder(userId: string): string {
  return `uploads/${createHash('sha256').update(userId).digest('hex').slice(0, 16)}`;
}

const textPath = (id: string) => `texts/${id}.txt`;
const chunksPath = (id: string) => `chunks/${id}.json`;

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export async function createIngest(userId: string, filename: string, storagePath: string, replaceBookId?: string | null): Promise<IngestRow> {
  const { data, error } = await supabase.from('library_ingests')
    .insert({ user_id: userId, filename, storage_path: storagePath, replace_book_id: replaceBookId ?? null }).select().single();
  if (error) throw new Error(`could not start the upload: ${error.message}`);
  return data as IngestRow;
}

export async function getIngest(userId: string, id: string): Promise<IngestRow | null> {
  const { data } = await supabase.from('library_ingests').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
  return (data as IngestRow) ?? null;
}

export async function latestOpenIngest(userId: string): Promise<IngestRow | null> {
  const { data } = await supabase.from('library_ingests').select('*').eq('user_id', userId)
    .not('stage', 'in', '(done,failed)').gte('updated_at', new Date(Date.now() - 3_600_000).toISOString())
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  return (data as IngestRow) ?? null;
}

async function claim(row: IngestRow): Promise<boolean> {
  const now = new Date();
  const { data } = await supabase.from('library_ingests')
    .update({ running_until: new Date(now.getTime() + CLAIM_MS).toISOString() })
    .eq('id', row.id).eq('stage', row.stage)
    .or(`running_until.is.null,running_until.lt.${now.toISOString()}`).select('id');
  return !!data && data.length > 0;
}

async function commit(row: IngestRow, patch: Partial<IngestRow>): Promise<IngestRow> {
  const { data, error } = await supabase.from('library_ingests')
    .update({ ...patch, running_until: null, updated_at: new Date().toISOString() }).eq('id', row.id).select().single();
  if (error) throw new Error(`could not save progress: ${error.message}`);
  return data as IngestRow;
}

async function readText(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`could not read ${path}: ${error?.message ?? 'missing'}`);
  return await data.text();
}

async function writeText(path: string, body: string, contentType: string) {
  const { error } = await supabase.storage.from(BUCKET).upload(path, new Blob([body], { type: contentType }), { upsert: true, contentType });
  if (error) throw new Error(`could not store ${path}: ${error.message}`);
}

/** Remove the uploaded PDF and working files — the book lives on as library rows. */
async function removeFiles(row: IngestRow) {
  await supabase.storage.from(BUCKET).remove([row.storage_path, textPath(row.id), chunksPath(row.id)]).catch(() => {});
}

/** Undo a half-written book. */
async function removeBook(bookId: string) {
  await supabase.from('book_instructions').delete().eq('book_id', bookId);
  await supabase.from('coaching_books').delete().eq('id', bookId);
}

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

async function runStage(row: IngestRow): Promise<Partial<IngestRow>> {
  const t = Date.now();
  const timings = { ...row.timings };
  const took = (k: string) => { timings[k] = (timings[k] ?? 0) + (Date.now() - t); };

  switch (row.stage) {
    case 'uploaded': {
      const { data: file, error } = await supabase.storage.from(BUCKET).download(row.storage_path);
      if (error || !file) throw new Error(`the uploaded PDF could not be read (${error?.message ?? 'missing'})`);
      if (file.size > MAX_BOOK_BYTES) throw new Error('the file is larger than 50 MB');
      // A text file (an article compilation, or OCR text of a scanned book)
      // needs no parsing.
      if (/\.txt$/i.test(row.filename)) {
        const plain = (await file.text()).trim();
        if (plain.length < MIN_TEXT_CHARS) throw new Error(`the text file has only ${plain.length} characters`);
        await writeText(textPath(row.id), plain, 'text/plain');
        took('extract');
        return { stage: 'extracted', pages: null, text_chars: plain.length, timings };
      }
      // Imported here, never at module load: pdfjs needs DOMMatrix, which
      // Node on Vercel lacks — see app/api/coach/resources/route.ts.
      const { CanvasFactory } = await import('pdf-parse/worker');
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: new Uint8Array(await file.arrayBuffer()), CanvasFactory });
      let text = '';
      let pages = 0;
      try {
        const result = await parser.getText();
        text = (result.text || '').trim();
        pages = result.total ?? result.pages?.length ?? 0;
      } finally {
        await parser.destroy().catch(() => {});
      }
      if (text.length < MIN_TEXT_CHARS) {
        throw new Error(`only ${text.length} characters of text in ${pages} pages — this looks like a scanned book with no text layer. Upload a PDF with selectable text.`);
      }
      await writeText(textPath(row.id), text, 'text/plain');
      took('extract');
      return { stage: 'extracted', pages, text_chars: text.length, timings };
    }

    case 'extracted': {
      const text = await readText(textPath(row.id));
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) throw new Error('OpenRouter API key not configured');
      const r = await callOpenRouter(
        [{ role: 'system', content: METADATA_PROMPT }, { role: 'user', content: metadataSample(text) }],
        { apiKey, model: MODEL_FOR.chat_default, maxTokens: 1500 },
      );
      if (r.error) throw new Error(`the AI could not read the book (${r.error})`);
      const meta = parseBookMeta(extractJson(r.content), row.filename);
      // Same book twice would double every passage the coaches retrieve.
      // The book being replaced is not a duplicate — it is the point.
      const { data: all } = await supabase.from('coaching_books').select('id, title');
      const others = (all ?? []).filter((b: { id: string }) => b.id !== row.replace_book_id);
      const duplicate = findDuplicateTitle(meta.title, others.map((b: { title: string }) => b.title));
      // LIBRARY_INGEST_ALLOW_DUPLICATES is for scripts/verify-library-ingest.ts
      // only, which loads an existing book again and then deletes it.
      if (duplicate && process.env.LIBRARY_INGEST_ALLOW_DUPLICATES !== '1') {
        throw new Error(`"${duplicate}" is already in the library — to swap it for this file, choose it under "Replaces"`);
      }
      took('analyze');
      return { stage: 'analyzed', meta, timings };
    }

    case 'analyzed': {
      const meta = row.meta!;
      const text = await readText(textPath(row.id));
      const chunks = buildChunks(text);
      if (chunks.length === 0) throw new Error('no usable sections could be made from the text');
      const { data: book, error } = await supabase.from('coaching_books').insert({
        title: meta.title,
        author: meta.author,
        methodology: meta.methodology,
        level: meta.level,
        tags: meta.tags,
        phases: meta.phases,
        focus_areas: meta.focus_areas,
        raw_metadata: {
          description: meta.description, year: meta.year, sample_questions: meta.sample_questions,
          source: 'library_upload', filename: row.filename, pages: row.pages, ingest_id: row.id,
        },
      }).select('id').single();
      if (error || !book) throw new Error(`could not create the book (${error?.message})`);
      try {
        await writeText(chunksPath(row.id), JSON.stringify(chunks), 'application/json');
      } catch (e) {
        await removeBook(book.id);
        throw e;
      }
      took('chunk');
      return { stage: 'chunked', book_id: book.id, chunks_total: chunks.length, chunks_done: 0, timings };
    }

    case 'chunked': {
      const chunks = JSON.parse(await readText(chunksPath(row.id))) as BookChunk[];
      let done = row.chunks_done;
      while (done < chunks.length && Date.now() - t < EMBED_BUDGET_MS) {
        const batch = chunks.slice(done, done + 100);
        const res = await generateEmbeddingsBatch(batch.map((c) => c.content), 100);
        if (res.error || res.embeddings.length !== batch.length) throw new Error(`embedding failed (${res.error ?? 'partial batch'})`);
        const { error } = await supabase.from('book_instructions').insert(batch.map((c, i) => ({
          book_id: row.book_id,
          chapter_number: c.chapter_number,
          chapter_title: c.chapter_title,
          content: c.content,
          key_rules: c.key_rules,
          applies_to_phase: c.applies_to_phase,
          applies_to_workout_type: c.applies_to_workout_type,
          embedding: formatEmbeddingForStorage(res.embeddings[i].embedding),
          token_count: c.token_count,
        })));
        if (error) throw new Error(`could not save sections (${error.message})`);
        done += batch.length;
      }
      took('embed');
      return { stage: done >= chunks.length ? 'embedded' : 'chunked', chunks_done: done, timings };
    }

    case 'embedded': {
      const meta = row.meta!;
      const questions = meta.sample_questions.length ? meta.sample_questions.slice(0, 3) : meta.focus_areas.slice(0, 3);
      const check = await Promise.all(questions.map(async (question) => {
        const ctx = await retrieveBookContext(question, {}, 1500).catch(() => null);
        return { question, found: !!ctx?.sources.some((s) => s.bookTitle === meta.title) };
      }));
      // Only now, with the new book fully in and checked, is the old one
      // removed — a snapshot of it is kept on this ingest row.
      let replaced: Record<string, unknown> | null = null;
      if (row.replace_book_id) {
        const [{ data: oldBook }, { data: oldSections }] = await Promise.all([
          supabase.from('coaching_books').select('*').eq('id', row.replace_book_id).maybeSingle(),
          supabase.from('book_instructions').select('chapter_number, chapter_title, content').eq('book_id', row.replace_book_id),
        ]);
        if (oldBook) {
          replaced = { book: oldBook, sections: oldSections ?? [] };
          await removeBook(row.replace_book_id);
        }
      }
      took('check');
      await removeFiles(row);
      return { stage: 'done', check_result: check, replaced, timings };
    }

    default:
      return {};
  }
}

/** Run the next stage. `busy` = another request holds it; poll instead. */
export async function advanceIngest(userId: string, id: string): Promise<{ row: IngestRow; busy: boolean }> {
  const row = await getIngest(userId, id);
  if (!row) throw new Error('upload not found');
  if (row.stage === 'done' || row.stage === 'failed') return { row, busy: false };
  if (!(await claim(row))) return { row, busy: true };
  try {
    return { row: await commit(row, await runStage(row)), busy: false };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'failed';
    if (row.book_id) await removeBook(row.book_id).catch(() => {});
    await removeFiles(row);
    return { row: await commit(row, { stage: 'failed', error: `${INGEST_LABELS[row.stage]}: ${message}`, book_id: null }), busy: false };
  }
}
