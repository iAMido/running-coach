/**
 * Load coaching books from JSON files into Supabase
 * Processes pages, chunks text, generates embeddings, and stores in database
 *
 * Usage: npx tsx scripts/load-books.ts <path-to-json-file>
 *
 * JSON format expected: [{ page_number: number, text: string, tables: [] }, ...]
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
// Use OpenRouter for embeddings (supports OpenAI embedding models)
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

interface BookPage {
  page_number: number;
  text: string;
  tables: unknown[];
}

interface BookMetadata {
  title: string;
  author: string;
  methodology: string;
  level: string;
  tags: string[];
  phases: string[];
  focus_areas: string[];
}

// Book metadata mapping (based on the books provided)
const BOOK_METADATA: Record<string, BookMetadata> = {
  'Run Elite': {
    title: 'Run Elite: Train and Think Like the Greatest Distance Runners',
    author: 'Andrew Snow',
    methodology: 'Triphasic',
    level: 'intermediate',
    tags: ['mindset', 'elite', 'triphasic', 'marathon', 'ultramarathon'],
    phases: ['Base', 'Support', 'Specific', 'Taper'],
    focus_areas: ['mindset', 'training structure', 'periodization', 'performance psychology'],
  },
  '80_20': {
    title: '80/20 Running: Run Stronger and Race Faster by Training Slower',
    author: 'Matt Fitzgerald',
    methodology: '80/20',
    level: 'all',
    tags: ['80/20', 'low intensity', 'heart rate', 'pace'],
    phases: ['Base', 'Build', 'Peak', 'Taper'],
    focus_areas: ['intensity distribution', 'aerobic base', 'recovery', 'race preparation'],
  },
  'Run Faster': {
    title: 'Run Faster from the 5K to the Marathon',
    author: 'Brad Hudson & Matt Fitzgerald',
    methodology: 'Adaptive',
    level: 'intermediate',
    tags: ['adaptive', 'self-coaching', '5K', '10K', 'half marathon', 'marathon'],
    phases: ['Aerobic Support', 'Muscle Training', 'Specific Endurance'],
    focus_areas: ['adaptive training', 'self-assessment', 'plan creation'],
  },
  'Better Training': {
    title: 'Better Training for Distance Runners',
    author: 'David E. Martin & Peter N. Coe',
    methodology: 'Scientific',
    level: 'advanced',
    tags: ['scientific', 'periodization', 'physiology', 'biomechanics'],
    phases: ['Base', 'Build', 'Specific', 'Taper'],
    focus_areas: ['physiology', 'biomechanics', 'periodization', 'race strategy'],
  },
  'Endure': {
    title: 'Endure: Mind, Body, and the Curiously Elastic Limits of Human Performance',
    author: 'Alex Hutchinson',
    methodology: 'Mind-Body',
    level: 'all',
    tags: ['psychology', 'limits', 'mental', 'endurance', 'science'],
    phases: ['All'],
    focus_areas: ['mental limits', 'psychology', 'pain management', 'performance barriers'],
  },
};

/**
 * Detect which book based on filename
 */
function detectBook(filename: string): BookMetadata | null {
  const nameLower = filename.toLowerCase();

  if (nameLower.includes('run elite') || nameLower.includes('snow')) {
    return BOOK_METADATA['Run Elite'];
  }
  if (nameLower.includes('80_20') || nameLower.includes('80/20')) {
    return BOOK_METADATA['80_20'];
  }
  if (nameLower.includes('run faster') || nameLower.includes('hudson')) {
    return BOOK_METADATA['Run Faster'];
  }
  if (nameLower.includes('better training') || nameLower.includes('martin') || nameLower.includes('coe')) {
    return BOOK_METADATA['Better Training'];
  }
  if (nameLower.includes('endure') || nameLower.includes('hutchinson')) {
    return BOOK_METADATA['Endure'];
  }

  return null;
}

/**
 * Chunk text into smaller pieces for embedding
 * Aims for ~500-800 tokens per chunk
 */
function chunkText(
  text: string,
  maxChars: number = 2000,
  overlap: number = 200
): string[] {
  if (text.length <= maxChars) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + maxChars;

    // Try to break at paragraph or sentence boundary
    if (end < text.length) {
      // Look for paragraph break
      const paragraphBreak = text.lastIndexOf('\n\n', end);
      if (paragraphBreak > start + maxChars / 2) {
        end = paragraphBreak;
      } else {
        // Look for sentence break
        const sentenceBreak = text.lastIndexOf('. ', end);
        if (sentenceBreak > start + maxChars / 2) {
          end = sentenceBreak + 1;
        }
      }
    }

    chunks.push(text.slice(start, end).trim());
    start = end - overlap;
  }

  return chunks.filter(c => c.length > 50); // Filter out tiny chunks
}

/**
 * Detect chapter and section from text
 */
function detectChapter(text: string): { title?: string; number?: number } {
  // Look for "Chapter X:" or "CHAPTER X" patterns
  const chapterMatch = text.match(/chapter\s*(\d+)[:\s]*([^\n]+)?/i);
  if (chapterMatch) {
    return {
      number: parseInt(chapterMatch[1]),
      title: chapterMatch[2]?.trim(),
    };
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
  if (textLower.includes('base phase') || textLower.includes('base training') || textLower.includes('base period')) {
    phase = 'Base';
  } else if (textLower.includes('build phase') || textLower.includes('build period')) {
    phase = 'Build';
  } else if (textLower.includes('specific phase') || textLower.includes('specific training') || textLower.includes('peak phase')) {
    phase = 'Specific';
  } else if (textLower.includes('taper') || textLower.includes('race week')) {
    phase = 'Taper';
  }

  // Detect workout type
  let workoutType: string | undefined;
  if (textLower.includes('easy run') || textLower.includes('recovery run')) {
    workoutType = 'Easy';
  } else if (textLower.includes('tempo') || textLower.includes('threshold')) {
    workoutType = 'Tempo';
  } else if (textLower.includes('interval') || textLower.includes('speed work') || textLower.includes('vo2')) {
    workoutType = 'Intervals';
  } else if (textLower.includes('long run') || textLower.includes('endurance run')) {
    workoutType = 'Long Run';
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
    rules.push(...bulletMatches.slice(0, 5).map(m => m.replace(/^[•\-\*]\s*/, '').trim()));
  }

  // Look for numbered points
  const numberedMatches = text.match(/\d+\.\s*([^\n]+)/g);
  if (numberedMatches && rules.length < 3) {
    rules.push(...numberedMatches.slice(0, 3).map(m => m.replace(/^\d+\.\s*/, '').trim()));
  }

  return rules.filter(r => r.length > 10 && r.length < 200);
}

/**
 * Generate embedding for text using OpenRouter (routes to OpenAI embedding models)
 */
async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://running-coach.app',
        'X-Title': 'Running Coach RAG',
      },
      body: JSON.stringify({
        model: 'openai/text-embedding-3-small',
        input: text.slice(0, 8000), // Limit input size
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
    console.error('Usage: npx tsx scripts/load-books.ts <path-to-json-file>');
    console.error('\nBooks to load:');
    Object.entries(BOOK_METADATA).forEach(([key, meta]) => {
      console.log(`  - ${meta.title} (${meta.methodology})`);
    });
    process.exit(1);
  }

  console.log(`Loading book: ${filePath}`);

  // Read JSON file
  const content = fs.readFileSync(filePath, 'utf-8');
  const pages: BookPage[] = JSON.parse(content);

  console.log(`Found ${pages.length} pages`);

  // Detect book metadata
  const filename = path.basename(filePath);
  const metadata = detectBook(filename);

  if (!metadata) {
    console.error('Could not detect book. Supported books:');
    Object.values(BOOK_METADATA).forEach(m => console.log(`  - ${m.title}`));
    process.exit(1);
  }

  console.log(`Detected book: ${metadata.title}`);
  console.log(`Methodology: ${metadata.methodology}`);

  // Check if book already exists
  const { data: existingBook } = await supabase
    .from('coaching_books')
    .select('id')
    .eq('title', metadata.title)
    .single();

  let bookId: string;

  if (existingBook) {
    console.log(`Book already exists, updating...`);
    bookId = existingBook.id;

    // Delete existing instructions for this book
    await supabase
      .from('book_instructions')
      .delete()
      .eq('book_id', bookId);
  } else {
    // Create book record
    const { data: newBook, error: bookError } = await supabase
      .from('coaching_books')
      .insert({
        title: metadata.title,
        author: metadata.author,
        methodology: metadata.methodology,
        level: metadata.level,
        tags: metadata.tags,
        phases: metadata.phases,
        focus_areas: metadata.focus_areas,
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

  // Combine all page text
  const fullText = pages
    .filter(p => p.text && p.text.trim().length > 0)
    .map(p => p.text)
    .join('\n\n');

  console.log(`Total text length: ${fullText.length} characters`);

  // Chunk the text
  const chunks = chunkText(fullText, 2500, 200);
  console.log(`Created ${chunks.length} chunks`);

  // Process each chunk
  let processed = 0;
  let errors = 0;
  let currentChapter: { title?: string; number?: number } = {};

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    // Update chapter info if detected
    const detectedChapter = detectChapter(chunk);
    if (detectedChapter.number) {
      currentChapter = detectedChapter;
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
    const { error: insertError } = await supabase
      .from('book_instructions')
      .insert({
        book_id: bookId,
        chapter_number: currentChapter.number,
        chapter_title: currentChapter.title,
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
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  console.log(`\n=== IMPORT COMPLETE ===`);
  console.log(`Book: ${metadata.title}`);
  console.log(`Chunks processed: ${processed}`);
  console.log(`Errors: ${errors}`);
}

main().catch(console.error);
