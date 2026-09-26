/** Run with `bun test`. */
import { expect, test } from 'bun:test';
import { buildChunks, chunkBookText, cleanBookText, detectChapter, findDuplicateTitle, parseBookMeta } from './book-ingest';

test('paragraph breaks survive cleaning, so chunks can break on them', () => {
  const t = cleanBookText('First para line one\nline two.\n\n\n\nSecond para.\r\n\r\nThird.');
  expect(t).toContain('\n\n');
  expect(t.split('\n\n').length).toBe(3);
});

test('chunks stay near the target size, overlap, and never lose the tail', () => {
  const para = 'Easy running builds the aerobic base. '.repeat(40);
  const text = Array.from({ length: 8 }, () => para).join('\n\n');
  const chunks = chunkBookText(text, 2500, 200);
  expect(chunks.length).toBeGreaterThan(3);
  expect(chunks.every((c) => c.length <= 2500)).toBe(true);
  expect(chunks[chunks.length - 1].endsWith('base.')).toBe(true);
});

test('a chapter title is one line — not the rest of the chunk (the old loader\'s bug)', () => {
  const c = detectChapter('Some text\nChapter 7: The Long Run\nThe long run is the cornerstone of...');
  expect(c).toEqual({ number: 7, title: 'The Long Run' });
  expect(detectChapter('as discussed in the previous section')).toBeNull();
});

test('chapters carry forward to later chunks; tags come from the content', () => {
  const body = 'Uphill running and vertical gain. '.repeat(90);
  const chunks = buildChunks(`Chapter 3: Climbing\n${body}\n\n${body}`);
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.every((c) => c.chapter_number === 3)).toBe(true);
  expect(chunks[0].applies_to_workout_type).toBe('Hills');
});

test('metadata: model output is validated, and the filename fills a missing title', () => {
  const m = parseBookMeta({ author: 'A', tags: ['Marathon', 7, ''], year: 'x' }, 'Pfitzinger - Advanced marathoning (2009) - libgen.li.pdf');
  expect(m.title).toBe('Pfitzinger - Advanced marathoning (2009)');
  expect(m.tags).toEqual(['marathon']);
  expect(m.year).toBeNull();
  expect(m.methodology.length).toBeGreaterThan(0);
});

test('duplicates are caught in both directions, ignoring editions and subtitles', () => {
  const library = ['Advanced Marathoning', 'Training for the Uphill Athlete: A Manual for Mountain Runners and Ski Mountaineers', '80/20 Running: Run Stronger and Race Faster by Training Slower'];
  // The case that slipped through: the AI read the edition into the title.
  expect(findDuplicateTitle('Advanced Marathoning, Second Edition', library)).toBe('Advanced Marathoning');
  expect(findDuplicateTitle('Training for the Uphill Athlete', library)).toContain('Uphill Athlete');
  expect(findDuplicateTitle('80/20 Running', library)).toContain('80/20');
  expect(findDuplicateTitle('Daniels Running Formula', library)).toBeNull();
  expect(detectChapter('\nChapter 1 Elements of Training 3\ntext')!.title).toBe('Elements of Training');
});
