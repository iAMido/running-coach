/**
 * Turning a book's text into library rows — pure, shared by the Coach Library
 * upload (lib/library/ingest.ts) and testable without a database.
 *
 * Differs from scripts/load-book-pdf.ts in two deliberate ways, both bugs in
 * the script: it collapsed every newline to a space BEFORE looking for
 * paragraph breaks (so it never found one), and its chapter regex then
 * captured the rest of the chunk as the "chapter title". Here paragraphs and
 * lines survive until chunking, and a chapter title is one line of ≤ 80 chars.
 */

export interface BookMeta {
  title: string;
  author: string;
  year: number | null;
  /** 2-3 sentences: what the book teaches and who it is for. */
  description: string;
  /** Short methodology name the coaches cite, e.g. "Uphill Athlete", "80/20". */
  methodology: string;
  level: string;
  tags: string[];
  focus_areas: string[];
  phases: string[];
  /** Questions this book answers well — used by the retrieval check. */
  sample_questions: string[];
}

export interface BookChunk {
  content: string;
  chapter_number: number | null;
  chapter_title: string | null;
  applies_to_phase: string | null;
  applies_to_workout_type: string | null;
  key_rules: string[] | null;
  token_count: number;
}

const CHUNK_CHARS = 2500;
const OVERLAP = 200;

/** Normalise PDF text but KEEP paragraph breaks. */
export function cleanBookText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/-\n(?=[a-z])/g, '') // re-join words hyphenated across lines
    .replace(/\n[ \t]*\d{1,4}[ \t]*\n/g, '\n') // bare page numbers
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Paragraph-then-sentence aware chunks of ~2,500 chars with 200 overlap. */
export function chunkBookText(text: string, maxChars = CHUNK_CHARS, overlap = OVERLAP): string[] {
  if (text.length <= maxChars) return text.length > 50 ? [text] : [];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const para = text.lastIndexOf('\n\n', end);
      const sentence = text.lastIndexOf('. ', end);
      if (para > start + maxChars / 2) end = para;
      else if (sentence > start + maxChars / 2) end = sentence + 1;
    }
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 50) chunks.push(chunk);
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

/** "Chapter 7: The Long Run" on its own line → { 7, 'The Long Run' }. */
export function detectChapter(chunk: string): { number: number; title: string | null } | null {
  const m = chunk.match(/(?:^|\n)\s*chapter\s+(\d{1,3})\b[ .:\-–—]*([^\n]{0,80})/i);
  if (!m) return null;
  // Drop a trailing page number ("Elements of Training 3").
  const title = m[2]?.trim().replace(/\s+\d{1,4}$/, '') || null;
  return { number: parseInt(m[1], 10), title: title && title.length > 2 ? title : null };
}

export function detectAppliesTo(chunk: string): { phase: string | null; workoutType: string | null } {
  const t = chunk.toLowerCase();
  const phase =
    /base phase|base training|base period|aerobic base/.test(t) ? 'Base'
    : /build phase|build period/.test(t) ? 'Build'
    : /specific phase|peak phase|race-specific|specific period/.test(t) ? 'Specific'
    : /taper|race week/.test(t) ? 'Taper'
    : null;
  const workoutType =
    /easy run|recovery run/.test(t) ? 'Easy'
    : /tempo|threshold/.test(t) ? 'Tempo'
    : /interval|speed work|repetitions/.test(t) ? 'Intervals'
    : /long run|endurance run/.test(t) ? 'Long Run'
    : /hill|uphill|climb|vertical/.test(t) ? 'Hills'
    : /strength|gym|resistance training/.test(t) ? 'Strength'
    : null;
  return { phase, workoutType };
}

export function extractKeyRules(chunk: string): string[] | null {
  const bullets = (chunk.match(/(?:^|\n)\s*[•\-*]\s*([^\n]+)/g) ?? []).map((m) => m.replace(/^\s*[•\-*]\s*/, '').trim());
  const numbered = (chunk.match(/(?:^|\n)\s*\d{1,2}[.)]\s+([^\n]+)/g) ?? []).map((m) => m.replace(/^\s*\d{1,2}[.)]\s+/, '').trim());
  const rules = [...bullets.slice(0, 5), ...(bullets.length < 3 ? numbered.slice(0, 3) : [])]
    .filter((r) => r.length > 10 && r.length < 200);
  return rules.length ? rules : null;
}

/** Every chunk with its chapter (carried forward), tags and key rules. */
export function buildChunks(rawText: string): BookChunk[] {
  const text = cleanBookText(rawText);
  let chapter: { number: number; title: string | null } | null = null;
  return chunkBookText(text).map((content) => {
    const found = detectChapter(content);
    if (found) chapter = found;
    const applies = detectAppliesTo(content);
    return {
      content: content.replace(/\s+/g, ' '),
      chapter_number: chapter?.number ?? null,
      chapter_title: chapter?.title ?? null,
      applies_to_phase: applies.phase,
      applies_to_workout_type: applies.workoutType,
      key_rules: extractKeyRules(content),
      token_count: Math.ceil(content.length / 4),
    };
  });
}

/**
 * What the metadata model reads: the opening (title page, contents,
 * introduction) plus three samples from the body, so it describes the whole
 * book rather than its preface.
 */
export function metadataSample(text: string): string {
  const head = text.slice(0, 24_000);
  const samples = [0.3, 0.55, 0.8].map((f) => {
    const at = Math.floor(text.length * f);
    return text.slice(at, at + 3_000);
  });
  return `${head}\n\n[... sample from 30% ...]\n${samples[0]}\n\n[... sample from 55% ...]\n${samples[1]}\n\n[... sample from 80% ...]\n${samples[2]}`;
}

export const METADATA_PROMPT = `You catalogue books for a running coach's methodology library. The coach AI retrieves passages from these books when it builds training plans and answers an athlete's questions, and cites each book by its methodology name.

From the book excerpt, return ONLY this JSON:
{
  "title": "full title including subtitle",
  "author": "all authors, comma-separated",
  "year": 2019 or null,
  "description": "2-3 sentences: what the book teaches, its approach, who it is for",
  "methodology": "a SHORT name the coach can cite, e.g. 'Uphill Athlete', '80/20', 'Pfitzinger', 'Norwegian Method', 'Hansons'",
  "level": "beginner | intermediate | advanced | all",
  "tags": ["6-10 lowercase topic tags, e.g. 'marathon', 'lactate threshold', 'strength', 'mountain running'"],
  "focus_areas": ["4-8 concrete topics the book covers in depth"],
  "phases": ["the training phases the book uses, in its own terms, e.g. 'Base', 'Build', 'Specific', 'Taper'"],
  "sample_questions": ["3 questions an athlete could ask that this book answers well"]
}
Use the book's own words for phases and methodology. If the excerpt is not about running or endurance training, still fill every field honestly and say so in the description.`;

/** Validate the model's metadata; fill what is missing from the filename rather than fail. */
export function parseBookMeta(raw: unknown, filename: string): BookMeta {
  const o = (raw ?? {}) as Record<string, unknown>;
  const strs = (x: unknown, max: number) => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim()).slice(0, max) : []);
  const fallbackTitle = filename.replace(/\.pdf$/i, '').replace(/\s*-\s*libgen.*$/i, '').replace(/[_]+/g, ' ').trim();
  const year = Number(o.year);
  return {
    title: typeof o.title === 'string' && o.title.trim() ? o.title.trim() : fallbackTitle,
    author: typeof o.author === 'string' ? o.author.trim() : '',
    year: Number.isFinite(year) && year > 1800 && year < 2100 ? year : null,
    description: typeof o.description === 'string' ? o.description.trim() : '',
    methodology: typeof o.methodology === 'string' && o.methodology.trim() ? o.methodology.trim().slice(0, 40) : fallbackTitle.slice(0, 40),
    level: typeof o.level === 'string' ? o.level.trim() : 'all',
    tags: strs(o.tags, 12).map((t) => t.toLowerCase()),
    focus_areas: strs(o.focus_areas, 10),
    phases: strs(o.phases, 8),
    sample_questions: strs(o.sample_questions, 5),
  };
}

/** Lowercase, no punctuation, no edition words — "Advanced Marathoning, Second Edition" → "advanced marathoning". */
export function normalizeTitle(title: string): string {
  return title.toLowerCase()
    .split(':')[0]
    .replace(/\b(\d+(st|nd|rd|th)|first|second|third|fourth|fifth|revised|updated|new|expanded)\s+edition\b/g, '')
    .replace(/\bedition\b/g, '')
    .replace(/[^a-z0-9\u0590-\u05ff ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The library book this upload duplicates, if any. Compares normalised titles
 * in BOTH directions: the first version matched one way only, so the AI's
 * "Advanced Marathoning, Second Edition" slipped past the loaded "Advanced
 * Marathoning" and the same 272 sections went in twice.
 */
export function findDuplicateTitle(title: string, existing: string[]): string | null {
  const t = normalizeTitle(title);
  if (t.length < 4) return null;
  return existing.find((e) => {
    const n = normalizeTitle(e);
    return n.length >= 4 && (n === t || n.includes(t) || t.includes(n));
  }) ?? null;
}
