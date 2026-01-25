import { supabase } from '@/lib/db/supabase';
import { generateEmbedding } from './embeddings';
import type { FormattedBookContext, InstructionSearchResult } from './types';

// Approximate tokens per character
const CHARS_PER_TOKEN = 4;

/**
 * Retrieve and format book context for AI consumption
 * Uses semantic search with optional filters
 */
export async function retrieveBookContext(
  query: string,
  filters: {
    phase?: string;
    workoutType?: string;
    level?: string;
  },
  maxTokens: number
): Promise<FormattedBookContext> {
  // Generate embedding for the query
  const embeddingResponse = await generateEmbedding(query);

  if (!embeddingResponse.embedding || embeddingResponse.embedding.length === 0 || embeddingResponse.error) {
    console.warn('Failed to generate embedding:', embeddingResponse.error);
    return {
      text: '## Methodology Guidelines\nNo book context available.',
      tokenCount: 0,
      sources: [],
    };
  }

  // Search for relevant instructions
  const instructions = await searchInstructionsFiltered(
    embeddingResponse.embedding,
    filters,
    Math.ceil(maxTokens / 500) // Estimate ~500 tokens per instruction
  );

  if (instructions.length === 0) {
    return {
      text: '## Methodology Guidelines\nNo relevant methodology found for this query.',
      tokenCount: 0,
      sources: [],
    };
  }

  // Format for AI with token limit
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const { text, sources } = formatInstructions(instructions, maxChars);

  return {
    text,
    tokenCount: Math.ceil(text.length / CHARS_PER_TOKEN),
    sources,
  };
}

/**
 * Search instructions with filters using pgvector similarity
 */
async function searchInstructionsFiltered(
  embedding: number[],
  filters: {
    phase?: string;
    workoutType?: string;
    level?: string;
  },
  limit: number
): Promise<InstructionSearchResult[]> {
  // Try using the RPC function if available
  const { data: rpcData, error: rpcError } = await supabase.rpc(
    'search_instructions_filtered',
    {
      query_embedding: embedding,
      match_threshold: 0.7,
      match_count: limit,
      filter_phase: filters.phase || null,
      filter_workout_type: filters.workoutType || null,
      filter_level: filters.level || null,
    }
  );

  if (!rpcError && rpcData) {
    return rpcData as InstructionSearchResult[];
  }

  // Fallback: Use basic similarity search without filters
  console.warn('Filtered search not available, using basic search:', rpcError?.message);
  return await searchInstructionsBasic(embedding, limit);
}

/**
 * Basic similarity search without filters
 */
async function searchInstructionsBasic(
  embedding: number[],
  limit: number
): Promise<InstructionSearchResult[]> {
  const { data, error } = await supabase.rpc('match_instructions', {
    query_embedding: embedding,
    match_threshold: 0.7,
    match_count: limit,
  });

  if (error) {
    console.error('Error in basic instruction search:', error);
    return [];
  }

  return (data || []) as InstructionSearchResult[];
}

/**
 * Format instructions for AI consumption
 */
function formatInstructions(
  instructions: InstructionSearchResult[],
  maxChars: number
): {
  text: string;
  sources: { bookTitle: string; methodology: string; chapterTitle?: string }[];
} {
  const lines: string[] = ['## Methodology Guidelines'];
  const sources: { bookTitle: string; methodology: string; chapterTitle?: string }[] = [];
  const seenSources = new Set<string>();

  let charCount = lines[0].length;

  for (const instruction of instructions) {
    const instructionText = formatSingleInstruction(instruction);

    // Check if adding this instruction would exceed limit
    if (charCount + instructionText.length > maxChars && sources.length > 0) {
      break;
    }

    lines.push(instructionText);
    charCount += instructionText.length;

    // Track sources (deduplicate)
    const sourceKey = `${instruction.book_title}-${instruction.chapter_title}`;
    if (!seenSources.has(sourceKey)) {
      seenSources.add(sourceKey);
      sources.push({
        bookTitle: instruction.book_title,
        methodology: instruction.methodology,
        chapterTitle: instruction.chapter_title,
      });
    }
  }

  return { text: lines.join('\n\n'), sources };
}

/**
 * Format a single instruction entry
 */
function formatSingleInstruction(instruction: InstructionSearchResult): string {
  const parts: string[] = [];

  // Source attribution
  parts.push(`### From "${instruction.book_title}" (${instruction.methodology})`);

  if (instruction.chapter_title) {
    parts.push(`Chapter: ${instruction.chapter_title}`);
  }

  if (instruction.section_title) {
    parts.push(`Section: ${instruction.section_title}`);
  }

  // Main content
  parts.push('');
  parts.push(instruction.content);

  // Key rules if available
  if (instruction.key_rules && instruction.key_rules.length > 0) {
    parts.push('');
    parts.push('Key Rules:');
    for (const rule of instruction.key_rules) {
      parts.push(`- ${rule}`);
    }
  }

  return parts.join('\n');
}

/**
 * Get book schedules matching criteria
 * Useful for plan generation
 */
export async function getMatchingSchedules(
  filters: {
    targetRace?: string;
    level?: string;
    durationWeeks?: number;
  },
  limit: number = 3
): Promise<{
  schedules: Array<{
    id: string;
    bookTitle: string;
    methodology: string;
    planName: string;
    targetRace?: string;
    level?: string;
    durationWeeks?: number;
    weeklyStructure: unknown;
  }>;
}> {
  let query = supabase
    .from('book_schedules')
    .select(`
      id,
      plan_name,
      target_race,
      level,
      duration_weeks,
      weekly_structure,
      coaching_books!inner (
        title,
        methodology
      )
    `)
    .limit(limit);

  // Apply filters
  if (filters.targetRace) {
    query = query.ilike('target_race', `%${filters.targetRace}%`);
  }
  if (filters.level) {
    query = query.eq('level', filters.level);
  }
  if (filters.durationWeeks) {
    // Allow some flexibility in duration
    query = query.gte('duration_weeks', filters.durationWeeks - 2);
    query = query.lte('duration_weeks', filters.durationWeeks + 2);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching schedules:', error);
    return { schedules: [] };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return {
    schedules: (data || []).map((row: any) => ({
      id: row.id,
      bookTitle: row.coaching_books?.title || row.coaching_books?.[0]?.title || 'Unknown',
      methodology: row.coaching_books?.methodology || row.coaching_books?.[0]?.methodology || 'Unknown',
      planName: row.plan_name,
      targetRace: row.target_race,
      level: row.level,
      durationWeeks: row.duration_weeks,
      weeklyStructure: row.weekly_structure,
    })),
  };
}

/**
 * Get all available methodologies from books
 */
export async function getAvailableMethodologies(): Promise<string[]> {
  const { data, error } = await supabase
    .from('coaching_books')
    .select('methodology');

  if (error) {
    console.error('Error fetching methodologies:', error);
    return [];
  }

  return [...new Set(data?.map(d => d.methodology).filter(Boolean))] as string[];
}

/**
 * Get book count for health check
 */
export async function getBooksCount(): Promise<number> {
  const { count, error } = await supabase
    .from('coaching_books')
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.error('Error counting books:', error);
    return 0;
  }

  return count || 0;
}

/**
 * Get instructions count for health check
 */
export async function getInstructionsCount(): Promise<number> {
  const { count, error } = await supabase
    .from('book_instructions')
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.error('Error counting instructions:', error);
    return 0;
  }

  return count || 0;
}
