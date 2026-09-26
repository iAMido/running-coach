/**
 * Load coaching book from PDF file into Supabase
 * Extracts text, chunks it, generates embeddings, and stores in database
 *
 * Usage: npx tsx scripts/load-book-pdf.ts <path-to-pdf-file> [--dry-run]
 *
 * --dry-run extracts, chunks and reports without writing anything. Use it
 * first: a re-run DELETES the book's existing chunks before re-embedding, so
 * a bad extraction discovered mid-write leaves the book half-loaded.
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
// pdf-parse 2.x exports a PDFParse CLASS. This line used to be
// `const pdfParse = require('pdf-parse')` and called it as a function, which
// throws "pdfParse is not a function" on 2.x — the script had been broken since
// the dependency moved, while the in-app upload route had already been updated.
// Mirrors app/api/coach/resources/route.ts exactly.
const { PDFParse } = require('pdf-parse');

async function extractPdf(buf: Buffer): Promise<{ text: string; numpages: number }> {
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const result = await parser.getText();
    return { text: result.text || '', numpages: result.total ?? result.pages?.length ?? 0 };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

const DRY_RUN = process.argv.includes('--dry-run');

// Load environment variables
// --env <path> matches the other scripts; worktrees have no .env.local.
const envIdx = process.argv.indexOf('--env');
dotenv.config({ path: envIdx >= 0 ? process.argv[envIdx + 1] : path.resolve(process.cwd(), '.env.local') });

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

// RunCoach tables live in the `runcoach` schema since the May 2026
// consolidation onto the CalTrack project. This client had no schema option,
// so it defaulted to `public` and failed with "Could not find the table
// 'public.coaching_books'" — the second way this script had silently stopped
// working, alongside the pdf-parse 2.x break. Mirrors lib/db/supabase.ts.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { db: { schema: 'runcoach' } });

interface BookMetadata {
  title: string;
  author: string;
  methodology: string;
  level: string;
  tags: string[];
  phases: string[];
  focus_areas: string[];
}

// Book metadata mapping
const BOOK_METADATA: Record<string, BookMetadata> = {
  // Added 2026-09-26. The first book in this corpus that covers mountain
  // training at all: before it, "power hike" appeared 0 times in 1,452 chunks
  // and retrieval answered trail questions with road hill-rep theory.
  'Uphill Athlete': {
    title: 'Training for the Uphill Athlete: A Manual for Mountain Runners and Ski Mountaineers',
    author: 'Steve House, Scott Johnston, Kilian Jornet',
    methodology: 'Uphill Athlete',
    level: 'intermediate-advanced',
    tags: ['mountain running', 'vertical', 'uphill', 'muscular endurance', 'aerobic threshold', 'strength', 'trail', 'ski mountaineering'],
    phases: ['Transition', 'Base', 'Specific', 'Taper'],
    focus_areas: ['aerobic base', 'aerobic threshold', 'muscular endurance', 'vertical training', 'uphill hiking', 'general and specific strength', 'periodization for mountain events'],
  },
  'Advanced Marathoning': {
    title: 'Advanced Marathoning',
    author: 'Pete Pfitzinger, Scott Douglas',
    methodology: 'Pfitzinger',
    level: 'advanced',
    tags: ['marathon', 'lactate threshold', 'medium-long run', 'periodization', 'recovery', 'mesocycles'],
    phases: ['Endurance', 'Lactate Threshold + Endurance', 'Race Preparation', 'Taper'],
    focus_areas: ['mesocycle periodization', 'lactate threshold runs', 'medium-long runs', 'recovery', 'taper', 'nutrition'],
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
};

/**
 * Detect which book based on filename
 */
function detectBook(filename: string): BookMetadata | null {
  const nameLower = filename.toLowerCase();

  // Checked FIRST: the matchers below are loose substrings ('martin', 'coe',
  // 'snow') that a longer author list could trip.
  if (nameLower.includes('uphill athlete') || nameLower.includes('jornet')) {
    return BOOK_METADATA['Uphill Athlete'];
  }
  if (nameLower.includes('advanced marathoning') || nameLower.includes('pfitzinger')) {
    return BOOK_METADATA['Advanced Marathoning'];
  }

  if (nameLower.includes('endure') || nameLower.includes('hutchinson')) {
    return BOOK_METADATA['Endure'];
  }
  if (nameLower.includes('run elite') || nameLower.includes('snow')) {
    return BOOK_METADATA['Run Elite'];
  }
  if (nameLower.includes('80_20') || nameLower.includes('80/20') || nameLower.includes('80-20')) {
    return BOOK_METADATA['80_20'];
  }
  if (nameLower.includes('run faster') || nameLower.includes('hudson')) {
    return BOOK_METADATA['Run Faster'];
  }
  if (nameLower.includes('better training') || nameLower.includes('martin') || nameLower.includes('coe')) {
    return BOOK_METADATA['Better Training'];
  }

  return null;
}

/**
 * Chunk text into smaller pieces for embedding
 */
function chunkText(
  text: string,
  maxChars: number = 2000,
  overlap: number = 200
): string[] {
  // Clean up the text
  text = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+/g, ' ')
    .trim();

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

    const chunk = text.slice(start, end).trim();
    if (chunk.length > 50) {
      chunks.push(chunk);
    }
    start = end - overlap;
  }

  return chunks;
}

/**
 * Detect chapter from text
 */
function detectChapter(text: string): { title?: string; number?: number } {
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

  let phase: string | undefined;
  if (textLower.includes('base phase') || textLower.includes('base training')) {
    phase = 'Base';
  } else if (textLower.includes('build phase') || textLower.includes('build period')) {
    phase = 'Build';
  } else if (textLower.includes('specific phase') || textLower.includes('peak phase')) {
    phase = 'Specific';
  } else if (textLower.includes('taper') || textLower.includes('race week')) {
    phase = 'Taper';
  }

  let workoutType: string | undefined;
  if (textLower.includes('easy run') || textLower.includes('recovery run')) {
    workoutType = 'Easy';
  } else if (textLower.includes('tempo') || textLower.includes('threshold')) {
    workoutType = 'Tempo';
  } else if (textLower.includes('interval') || textLower.includes('speed work')) {
    workoutType = 'Intervals';
  } else if (textLower.includes('long run') || textLower.includes('endurance run')) {
    workoutType = 'Long Run';
  }

  return { phase, workoutType };
}

/**
 * Extract key rules from text
 */
function extractKeyRules(text: string): string[] {
  const rules: string[] = [];

  const bulletMatches = text.match(/[•\-\*]\s*([^\n]+)/g);
  if (bulletMatches) {
    rules.push(...bulletMatches.slice(0, 5).map(m => m.replace(/^[•\-\*]\s*/, '').trim()));
  }

  const numberedMatches = text.match(/\d+\.\s*([^\n]+)/g);
  if (numberedMatches && rules.length < 3) {
    rules.push(...numberedMatches.slice(0, 3).map(m => m.replace(/^\d+\.\s*/, '').trim()));
  }

  return rules.filter(r => r.length > 10 && r.length < 200);
}

/**
 * Generate embedding using OpenRouter
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
    console.error('Usage: npx tsx scripts/load-book-pdf.ts <path-to-pdf-file>');
    process.exit(1);
  }

  console.log(`Loading PDF: ${filePath}`);

  // Read PDF file
  const dataBuffer = fs.readFileSync(filePath);
  const pdfData = await extractPdf(dataBuffer);

  console.log(`PDF has ${pdfData.numpages} pages`);
  console.log(`Extracted ${pdfData.text.length} characters`);

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

  if (DRY_RUN) {
    const chunks = chunkText(pdfData.text, 2500, 200);
    const phases: Record<string, number> = {};
    const types: Record<string, number> = {};
    let chapters = 0;
    for (const c of chunks) {
      const a = detectAppliesTo(c);
      phases[a.phase ?? '(none)'] = (phases[a.phase ?? '(none)'] ?? 0) + 1;
      types[a.workoutType ?? '(none)'] = (types[a.workoutType ?? '(none)'] ?? 0) + 1;
      if (detectChapter(c).number) chapters++;
    }
    console.log(`
DRY RUN — nothing written.`);
    console.log(`chunks: ${chunks.length} · avg ${Math.round(pdfData.text.length / Math.max(1, chunks.length))} chars`);
    console.log(`chapter markers detected: ${chapters}`);
    console.log(`applies_to_phase: ${JSON.stringify(phases)}`);
    console.log(`applies_to_workout_type: ${JSON.stringify(types)}`);
    return;
  }

  // Check if book already exists - delete old entries
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
    const { error: deleteError } = await supabase
      .from('book_instructions')
      .delete()
      .eq('book_id', bookId);

    if (deleteError) {
      console.error('Error deleting old instructions:', deleteError);
    } else {
      console.log('Deleted old instructions');
    }
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

  // Chunk the text
  const chunks = chunkText(pdfData.text, 2500, 200);
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

    // Rate limiting
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
