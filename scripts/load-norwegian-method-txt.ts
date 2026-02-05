/**
 * Load Norwegian Method research from TXT file into Supabase
 * This handles the compiled web research about the Norwegian Method
 *
 * Usage: npx tsx scripts/load-norwegian-method-txt.ts <path-to-txt-file>
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

if (!OPENROUTER_API_KEY) {
  console.error('Missing OPENROUTER_API_KEY for embeddings');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const BOOK_METADATA = {
  title: 'Norwegian Method Research Compilation',
  author: 'Various (Marius Bakken, Alex Hutchinson, et al.)',
  methodology: 'Norwegian',
  level: 'intermediate',
  tags: ['norwegian', 'lactate', 'threshold', 'double-threshold', 'MLSS', 'marius-bakken', 'ingebrigtsen', 'research'],
  phases: ['Base', 'Build', 'Specific', 'Taper'],
  focus_areas: [
    'lactate threshold training',
    'double threshold sessions',
    'lactate meter usage',
    'MLSS training',
    'Norwegian model history',
    'altitude training',
    'interval vs continuous threshold',
    'summer training adaptation',
  ],
};

/**
 * Chunk text into smaller pieces for embedding
 * Aims for ~500-800 tokens per chunk, breaking at natural boundaries
 */
function chunkText(
  text: string,
  maxChars: number = 2500,
  overlap: number = 200
): string[] {
  if (text.length <= maxChars) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + maxChars;

    // Try to break at section boundary (## or ###)
    if (end < text.length) {
      const sectionBreak = text.lastIndexOf('\n#', end);
      if (sectionBreak > start + maxChars / 2) {
        end = sectionBreak;
      } else {
        // Try paragraph break
        const paragraphBreak = text.lastIndexOf('\n\n', end);
        if (paragraphBreak > start + maxChars / 2) {
          end = paragraphBreak;
        } else {
          // Try sentence break
          const sentenceBreak = text.lastIndexOf('. ', end);
          if (sentenceBreak > start + maxChars / 2) {
            end = sentenceBreak + 1;
          }
        }
      }
    }

    chunks.push(text.slice(start, end).trim());
    start = end - overlap;
  }

  return chunks.filter((c) => c.length > 50);
}

/**
 * Detect section/chapter from text
 */
function detectSection(text: string): { title?: string; number?: number } {
  // Look for markdown headers
  const headerMatch = text.match(/^#+\s*(.+)/m);
  if (headerMatch) {
    return { title: headerMatch[1].trim() };
  }
  return {};
}

/**
 * Detect workout type or phase from content
 */
function detectAppliesTo(text: string): {
  phase?: string;
  workoutType?: string;
} {
  const textLower = text.toLowerCase();

  // Detect phase
  let phase: string | undefined;
  if (textLower.includes('base phase') || textLower.includes('base training') || textLower.includes('base period') || textLower.includes('winter')) {
    phase = 'Base';
  } else if (textLower.includes('build phase') || textLower.includes('build period') || textLower.includes('support')) {
    phase = 'Build';
  } else if (textLower.includes('specific phase') || textLower.includes('specific training') || textLower.includes('peak phase') || textLower.includes('summer training')) {
    phase = 'Specific';
  } else if (textLower.includes('taper') || textLower.includes('race week')) {
    phase = 'Taper';
  }

  // Detect workout type
  let workoutType: string | undefined;
  if (textLower.includes('easy run') || textLower.includes('recovery run') || textLower.includes('zone 1')) {
    workoutType = 'Easy';
  } else if (textLower.includes('tempo') || textLower.includes('threshold') || textLower.includes('lactate') || textLower.includes('double threshold')) {
    workoutType = 'Tempo';
  } else if (textLower.includes('interval') || textLower.includes('vo2') || textLower.includes('x element')) {
    workoutType = 'Intervals';
  } else if (textLower.includes('long run') || textLower.includes('endurance run')) {
    workoutType = 'Long Run';
  } else if (textLower.includes('hill') || textLower.includes('200m') || textLower.includes('sprint')) {
    workoutType = 'Hills';
  }

  return { phase, workoutType };
}

/**
 * Extract key rules/takeaways from text
 */
function extractKeyRules(text: string): string[] {
  const rules: string[] = [];

  // Look for bullet points or numbered lists
  const bulletMatches = text.match(/[•\-\*]\s*([^\n]+)/g);
  if (bulletMatches) {
    rules.push(...bulletMatches.slice(0, 5).map((m) => m.replace(/^[•\-\*]\s*/, '').trim()));
  }

  // Look for numbered points
  const numberedMatches = text.match(/\d+\.\s*([^\n]+)/g);
  if (numberedMatches && rules.length < 3) {
    rules.push(...numberedMatches.slice(0, 3).map((m) => m.replace(/^\d+\.\s*/, '').trim()));
  }

  // Look for key phrases about Norwegian method
  const keyPhrases = [
    /lactate.*?2[\.\-]?3\s*mmol/i,
    /double threshold/i,
    /80.*?20/i,
    /sweet spot/i,
    /MLSS/i,
  ];

  for (const pattern of keyPhrases) {
    const match = text.match(pattern);
    if (match && match[0].length > 10) {
      const context = text.substring(Math.max(0, text.indexOf(match[0]) - 50), text.indexOf(match[0]) + match[0].length + 50);
      if (!rules.includes(context.trim()) && rules.length < 5) {
        rules.push(context.trim());
      }
    }
  }

  return rules.filter((r) => r.length > 10 && r.length < 200);
}

/**
 * Generate embedding for text using OpenRouter
 */
async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://running-coach.app',
        'X-Title': 'Running Coach RAG',
      },
      body: JSON.stringify({
        model: 'openai/text-embedding-3-small',
        input: text.slice(0, 8000),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Embedding API error:', response.status, errorText);
      return null;
    }

    const data = await response.json();
    return data.data[0].embedding;
  } catch (error) {
    console.error('Error generating embedding:', error);
    return null;
  }
}

/**
 * Estimate token count
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error('Usage: npx tsx scripts/load-norwegian-method-txt.ts <path-to-txt-file>');
    process.exit(1);
  }

  console.log(`Loading Norwegian Method research: ${filePath}`);

  // Read TXT file
  const content = fs.readFileSync(filePath, 'utf-8');

  console.log(`Total text length: ${content.length} characters`);

  // Check if book already exists
  const { data: existingBook } = await supabase
    .from('coaching_books')
    .select('id')
    .eq('title', BOOK_METADATA.title)
    .single();

  let bookId: string;

  if (existingBook) {
    console.log(`Book already exists, updating...`);
    bookId = existingBook.id;

    // Delete existing instructions for this book
    await supabase.from('book_instructions').delete().eq('book_id', bookId);
  } else {
    // Create book record
    const { data: newBook, error: bookError } = await supabase
      .from('coaching_books')
      .insert({
        title: BOOK_METADATA.title,
        author: BOOK_METADATA.author,
        methodology: BOOK_METADATA.methodology,
        level: BOOK_METADATA.level,
        tags: BOOK_METADATA.tags,
        phases: BOOK_METADATA.phases,
        focus_areas: BOOK_METADATA.focus_areas,
      })
      .select()
      .single();

    if (bookError || !newBook) {
      console.error('Error creating book:', bookError);
      process.exit(1);
    }

    bookId = newBook.id;
    console.log(`Created book with ID: ${bookId}`);
  }

  // Chunk the text
  const chunks = chunkText(content, 2500, 200);
  console.log(`Created ${chunks.length} chunks`);

  // Process each chunk
  let processed = 0;
  let errors = 0;
  let currentSection: { title?: string; number?: number } = {};

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    // Update section info if detected
    const detectedSection = detectSection(chunk);
    if (detectedSection.title) {
      currentSection = detectedSection;
    }

    // Detect what this chunk applies to
    const appliesTo = detectAppliesTo(chunk);

    // Extract key rules
    const keyRules = extractKeyRules(chunk);

    // Generate embedding
    console.log(`Processing chunk ${i + 1}/${chunks.length}...`);
    const embedding = await generateEmbedding(chunk);

    if (!embedding) {
      console.error(`Failed to generate embedding for chunk ${i + 1}`);
      errors++;
      continue;
    }

    // Insert instruction
    const { error: insertError } = await supabase.from('book_instructions').insert({
      book_id: bookId,
      section_title: currentSection.title || `Norwegian Method Research - Part ${i + 1}`,
      content: chunk,
      key_rules: keyRules.length > 0 ? keyRules : null,
      applies_to_phase: appliesTo.phase,
      applies_to_workout_type: appliesTo.workoutType,
      embedding: embedding,
      token_count: estimateTokens(chunk),
    });

    if (insertError) {
      console.error(`Error inserting chunk ${i + 1}:`, insertError.message);
      errors++;
    } else {
      processed++;
    }

    // Rate limiting - wait between chunks
    if (i < chunks.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  console.log(`\n=== IMPORT COMPLETE ===`);
  console.log(`Book: ${BOOK_METADATA.title}`);
  console.log(`Chunks processed: ${processed}`);
  console.log(`Errors: ${errors}`);
}

main().catch(console.error);
