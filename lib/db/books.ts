/**
 * CRUD operations for coaching books, instructions, and schedules
 */

import { supabase } from './supabase';
import type {
  CoachingBook,
  BookInstruction,
  BookSchedule,
  BookMetadata,
  InstructionsData,
  SchedulesData,
  InstructionSearchResult,
  ScheduleSearchResult,
} from '@/lib/rag/types';
import { generateEmbedding, countTokens, formatEmbeddingForStorage } from '@/lib/rag/embeddings';

// ============================================
// COACHING BOOKS CRUD
// ============================================

/**
 * Get all coaching books
 */
export async function getAllBooks(): Promise<CoachingBook[]> {
  const { data, error } = await supabase
    .from('coaching_books')
    .select('*')
    .order('title', { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * Get a single book by ID
 */
export async function getBookById(bookId: string): Promise<CoachingBook | null> {
  const { data, error } = await supabase
    .from('coaching_books')
    .select('*')
    .eq('id', bookId)
    .single();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

/**
 * Get a book by methodology
 */
export async function getBooksByMethodology(methodology: string): Promise<CoachingBook[]> {
  const { data, error } = await supabase
    .from('coaching_books')
    .select('*')
    .eq('methodology', methodology);

  if (error) throw error;
  return data || [];
}

/**
 * Create a new coaching book
 */
export async function createBook(
  metadata: BookMetadata
): Promise<CoachingBook> {
  const { data, error } = await supabase
    .from('coaching_books')
    .insert({
      title: metadata.title,
      author: metadata.author,
      methodology: metadata.methodology,
      tags: metadata.tags,
      level: metadata.level || 'all',
      focus_areas: metadata.focus_areas,
      phases: metadata.phases,
      raw_metadata: metadata,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Delete a book and all related data (cascade)
 */
export async function deleteBook(bookId: string): Promise<void> {
  const { error } = await supabase
    .from('coaching_books')
    .delete()
    .eq('id', bookId);

  if (error) throw error;
}

// ============================================
// BOOK INSTRUCTIONS CRUD
// ============================================

/**
 * Get all instructions for a book
 */
export async function getBookInstructions(bookId: string): Promise<BookInstruction[]> {
  const { data, error } = await supabase
    .from('book_instructions')
    .select('*')
    .eq('book_id', bookId)
    .order('chapter_number', { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * Create instruction with embedding
 */
export async function createInstruction(
  bookId: string,
  instruction: {
    chapter_number?: number;
    chapter_title?: string;
    section_title: string;
    content: string;
    key_rules?: string[];
    applies_to_phase?: string;
    applies_to_workout_type?: string;
  }
): Promise<BookInstruction> {
  // Generate embedding for the content
  const embeddingResult = await generateEmbedding(instruction.content);

  if (embeddingResult.error) {
    console.warn('Failed to generate embedding:', embeddingResult.error);
  }

  const { data, error } = await supabase
    .from('book_instructions')
    .insert({
      book_id: bookId,
      chapter_number: instruction.chapter_number,
      chapter_title: instruction.chapter_title,
      section_title: instruction.section_title,
      content: instruction.content,
      key_rules: instruction.key_rules,
      applies_to_phase: instruction.applies_to_phase,
      applies_to_workout_type: instruction.applies_to_workout_type,
      embedding: embeddingResult.embedding.length > 0
        ? formatEmbeddingForStorage(embeddingResult.embedding)
        : null,
      token_count: countTokens(instruction.content),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Bulk create instructions from structured data
 */
export async function createInstructionsFromData(
  bookId: string,
  instructionsData: InstructionsData
): Promise<{ count: number; errors: string[] }> {
  let count = 0;
  const errors: string[] = [];

  for (const chapter of instructionsData.chapters) {
    for (const section of chapter.sections) {
      try {
        await createInstruction(bookId, {
          chapter_number: chapter.number,
          chapter_title: chapter.title,
          section_title: section.title,
          content: section.content,
          key_rules: section.key_rules,
          applies_to_phase: section.applies_to_phase,
          applies_to_workout_type: section.applies_to_workout_type,
        });
        count++;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        errors.push(`Chapter ${chapter.number}, Section "${section.title}": ${message}`);
      }
    }
  }

  return { count, errors };
}

// ============================================
// BOOK SCHEDULES CRUD
// ============================================

/**
 * Get all schedules for a book
 */
export async function getBookSchedules(bookId: string): Promise<BookSchedule[]> {
  const { data, error } = await supabase
    .from('book_schedules')
    .select('*')
    .eq('book_id', bookId)
    .order('plan_name', { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * Create a schedule
 */
export async function createSchedule(
  bookId: string,
  schedule: {
    plan_name: string;
    target_race?: string;
    level?: string;
    weeks: unknown[];
  }
): Promise<BookSchedule> {
  const { data, error } = await supabase
    .from('book_schedules')
    .insert({
      book_id: bookId,
      plan_name: schedule.plan_name,
      target_race: schedule.target_race,
      level: schedule.level,
      duration_weeks: schedule.weeks.length,
      weekly_structure: schedule.weeks,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Bulk create schedules from structured data
 */
export async function createSchedulesFromData(
  bookId: string,
  schedulesData: SchedulesData
): Promise<{ count: number; errors: string[] }> {
  let count = 0;
  const errors: string[] = [];

  for (const template of schedulesData.plan_templates) {
    try {
      await createSchedule(bookId, {
        plan_name: template.name,
        target_race: template.target_race,
        level: template.level,
        weeks: template.weeks,
      });
      count++;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      errors.push(`Plan "${template.name}": ${message}`);
    }
  }

  return { count, errors };
}

// ============================================
// SEARCH FUNCTIONS (using RPC)
// ============================================

/**
 * Search instructions using semantic similarity
 */
export async function searchInstructionsByEmbedding(
  queryEmbedding: number[],
  options: {
    threshold?: number;
    limit?: number;
    phase?: string;
    workoutType?: string;
  } = {}
): Promise<InstructionSearchResult[]> {
  const { threshold = 0.7, limit = 5, phase, workoutType } = options;

  const { data, error } = await supabase.rpc('search_instructions', {
    query_embedding: formatEmbeddingForStorage(queryEmbedding),
    match_threshold: threshold,
    match_count: limit,
    filter_phase: phase || null,
    filter_workout_type: workoutType || null,
  });

  if (error) throw error;
  return data || [];
}

/**
 * Search schedules by criteria
 */
export async function searchSchedulesByCriteria(
  options: {
    targetRace?: string;
    level?: string;
    durationWeeks?: number;
  } = {}
): Promise<ScheduleSearchResult[]> {
  const { targetRace, level, durationWeeks } = options;

  const { data, error } = await supabase.rpc('search_schedules', {
    target_race_filter: targetRace || null,
    level_filter: level || null,
    duration_filter: durationWeeks || null,
  });

  if (error) throw error;
  return data || [];
}

// ============================================
// STATS & UTILITIES
// ============================================

/**
 * Get statistics about the book library
 */
export async function getLibraryStats(): Promise<{
  totalBooks: number;
  totalInstructions: number;
  totalSchedules: number;
  methodologies: string[];
}> {
  const [booksResult, instructionsResult, schedulesResult] = await Promise.all([
    supabase.from('coaching_books').select('methodology', { count: 'exact' }),
    supabase.from('book_instructions').select('id', { count: 'exact', head: true }),
    supabase.from('book_schedules').select('id', { count: 'exact', head: true }),
  ]);

  const methodologies = [...new Set(
    (booksResult.data || []).map(b => b.methodology).filter(Boolean)
  )];

  return {
    totalBooks: booksResult.count || 0,
    totalInstructions: instructionsResult.count || 0,
    totalSchedules: schedulesResult.count || 0,
    methodologies,
  };
}

/**
 * Check if any books are loaded
 */
export async function hasBooksLoaded(): Promise<boolean> {
  const { count, error } = await supabase
    .from('coaching_books')
    .select('id', { count: 'exact', head: true });

  if (error) throw error;
  return (count || 0) > 0;
}
