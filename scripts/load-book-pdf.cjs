/**
 * Load coaching book from PDF file into Supabase
 * Extracts text, chunks it, generates embeddings, and stores in database
 *
 * Usage: node scripts/load-book-pdf.cjs <path-to-pdf-file>
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { PDFParse } = require('pdf-parse');

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

if (!OPENROUTER_API_KEY) {
  console.error('Missing OPENROUTER_API_KEY for embeddings');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Book metadata mapping
const BOOK_METADATA = {
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
};

/**
 * Detect which book based on filename
 */
function detectBook(filename) {
  const nameLower = filename.toLowerCase();

  if (nameLower.includes('endure') || nameLower.includes('hutchinson')) {
    return BOOK_METADATA['Endure'];
  }
  if (nameLower.includes('run elite') || nameLower.includes('snow')) {
    return BOOK_METADATA['Run Elite'];
  }

  return null;
}

/**
 * Chunk text into smaller pieces for embedding
 */
function chunkText(text, maxChars = 2000, overlap = 200) {
  // Clean up the text
  text = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (text.length <= maxChars) {
    return [text];
  }

  const chunks = [];
  let start = 0;

  while (start < text.length) {
    let end = start + maxChars;

    if (end < text.length) {
      const paragraphBreak = text.lastIndexOf('\n\n', end);
      if (paragraphBreak > start + maxChars / 2) {
        end = paragraphBreak;
      } else {
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
function detectChapter(text) {
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
function detectAppliesTo(text) {
  const textLower = text.toLowerCase();

  let phase;
  if (textLower.includes('base phase') || textLower.includes('base training')) {
    phase = 'Base';
  } else if (textLower.includes('build phase') || textLower.includes('build period')) {
    phase = 'Build';
  } else if (textLower.includes('specific phase') || textLower.includes('peak phase')) {
    phase = 'Specific';
  } else if (textLower.includes('taper') || textLower.includes('race week')) {
    phase = 'Taper';
  }

  let workoutType;
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
function extractKeyRules(text) {
  const rules = [];

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
async function generateEmbedding(text) {
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
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error('Usage: node scripts/load-book-pdf.cjs <path-to-pdf-file>');
    process.exit(1);
  }

  console.log(`Loading PDF: ${filePath}`);

  // Read PDF file
  const dataBuffer = fs.readFileSync(filePath);
  const pdfData = await pdf(dataBuffer);

  console.log(`PDF has ${pdfData.numpages} pages`);
  console.log(`Extracted ${pdfData.text.length} characters`);

  // Detect book metadata
  const filename = path.basename(filePath);
  const metadata = detectBook(filename);

  if (!metadata) {
    console.error('Could not detect book. Please add metadata for this book.');
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

  let bookId;

  if (existingBook) {
    console.log(`Book already exists, updating...`);
    bookId = existingBook.id;

    // Delete existing instructions
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
  let currentChapter = {};

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    // Update chapter info
    const detectedChapter = detectChapter(chunk);
    if (detectedChapter.number) {
      currentChapter = detectedChapter;
    }

    // Detect applies to
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
