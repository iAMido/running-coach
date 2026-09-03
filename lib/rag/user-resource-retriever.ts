/**
 * Retriever for user-uploaded coach material. Mirrors book-retriever but
 * scoped per user_id via the runcoach.match_user_resources RPC.
 *
 * The retrieved chunks are returned in the same InstructionSearchResult
 * shape used for books, so the book-retriever can union them into the
 * same "Methodology Guidelines" block in the prompt without the caller
 * caring whether the source was a published book or the athlete's own
 * uploaded note.
 */

import { supabase } from '@/lib/db/supabase';
import { generateEmbedding } from './embeddings';
import type { InstructionSearchResult } from './types';

/** 0.05 below BOOK_MATCH_THRESHOLD so personal notes win ties. */
export const USER_RESOURCE_MATCH_THRESHOLD = 0.40;

interface UserResourceMatch {
  id: string;
  resource_id: string;
  resource_title: string;
  section_title: string | null;
  content: string;
  key_rules: string[] | null;
  similarity: number;
}

/**
 * Semantic search across the athlete's own uploaded chunks. Returns
 * results shaped like book instructions so the existing prompt formatter
 * can render them uniformly.
 */
export async function retrieveUserResources(
  userId: string,
  query: string,
  limit: number,
  /** Optional tag filter. When supplied, only resources whose
   *  methodology_tags overlap with these tags are returned. */
  tags?: string[],
  /** Pre-computed embedding for `query`. The book retriever already embeds
   *  the same string — passing it here avoids a duplicate OpenAI round-trip
   *  (~250ms + cost) on every request. */
  precomputedEmbedding?: number[],
): Promise<InstructionSearchResult[]> {
  if (!userId) return [];

  let embedding = precomputedEmbedding;
  if (!embedding?.length) {
    const embeddingResponse = await generateEmbedding(query);
    if (!embeddingResponse.embedding?.length || embeddingResponse.error) {
      return [];
    }
    embedding = embeddingResponse.embedding;
  }

  const tagFilter = tags && tags.length > 0 ? tags.map(t => t.toLowerCase()) : null;

  const { data, error } = await supabase.rpc('match_user_resources', {
    query_embedding: embedding,
    match_user_id: userId,
    // Kept 0.05 below the book floor so an athlete's own uploaded material
    // wins ties against a book chunk. See BOOK_MATCH_THRESHOLD for the
    // measurement behind the absolute value — 0.65 was above the observed
    // maximum similarity of the book corpus and could only return nothing.
    // Unverifiable against real data here: user_resources is empty.
    match_threshold: USER_RESOURCE_MATCH_THRESHOLD,
    match_count: limit,
    match_tags: tagFilter,
  });

  // If the tag filter returns nothing, retry without filter so the user
  // still gets relevant material — tags are best-effort routing, not a
  // hard requirement.
  if (!error && (!data || (data as unknown[]).length === 0) && tagFilter) {
    const fallback = await supabase.rpc('match_user_resources', {
      query_embedding: embedding,
      match_user_id: userId,
      match_threshold: USER_RESOURCE_MATCH_THRESHOLD,
      match_count: limit,
      match_tags: null,
    });
    if (!fallback.error && fallback.data) {
      const rows = fallback.data as UserResourceMatch[];
      return rows.map(r => ({
        id: r.id,
        book_id: r.resource_id,
        book_title: r.resource_title,
        methodology: 'Your Coach Library',
        chapter_title: undefined,
        section_title: r.section_title || undefined,
        content: r.content,
        key_rules: r.key_rules || undefined,
        similarity: r.similarity,
      }));
    }
  }

  if (error) {
    console.warn('match_user_resources failed:', error.message);
    return [];
  }

  const rows = (data || []) as UserResourceMatch[];
  return rows.map(r => ({
    id: r.id,
    book_id: r.resource_id, // reuse the slot
    book_title: r.resource_title,
    methodology: 'Your Coach Library', // marker so the prompt can tell sources apart
    chapter_title: undefined,
    section_title: r.section_title || undefined,
    content: r.content,
    key_rules: r.key_rules || undefined,
    similarity: r.similarity,
  }));
}

/**
 * Lightweight count for the supervisor preflight + health audit.
 */
export async function getUserResourceCounts(userId: string): Promise<{ resources: number; chunks: number }> {
  const [{ count: rc }, { count: cc }] = await Promise.all([
    supabase
      .from('user_resources')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'active'),
    supabase
      .from('user_resource_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId),
  ]);
  return { resources: rc || 0, chunks: cc || 0 };
}
