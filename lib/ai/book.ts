import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import { MAX_SLIDES } from '../schema';
import { bookFile, chapterDir } from '../paths';
import { runClaude } from './claude';
import { extractJson } from './revise';

export const BookSchema = z.object({
  title: z.string(),
  summary: z.string(),
  chapters: z
    .array(
      z.object({
        title: z.string(),
        points: z.array(z.string()).min(1),
        /** Which reference page this chapter was read from (1-based), when built from references. */
        source_page: z.number().int().optional(),
        /** The block sequence that reference page actually used, so our page mirrors its shape. */
        layout: z
          .array(
            z.object({
              type: z.enum(['heading', 'paragraph', 'bullets', 'sidebox', 'table', 'code', 'diagram', 'callout', 'qa']),
              note: z.string(),
            })
          )
          .optional(),
      })
    )
    .min(1),
});

export type Book = z.infer<typeof BookSchema>;

export function bookPath(subject: string, chapter: string) {
  return bookFile(subject, chapter);
}

export async function loadBook(subject: string, chapter: string): Promise<Book | null> {
  try {
    return BookSchema.parse(JSON.parse(await fs.readFile(bookPath(subject, chapter), 'utf8')));
  } catch {
    return null;
  }
}

export async function saveBook(subject: string, chapter: string, book: Book): Promise<Book> {
  const valid = BookSchema.parse(book);
  await fs.mkdir(chapterDir(subject, chapter), { recursive: true });
  await fs.writeFile(bookPath(subject, chapter), JSON.stringify(valid, null, 2));
  try {
    const { syncBook } = await import('../graph');
    syncBook(subject, chapter, valid);
  } catch (err) {
    console.warn('[instastudio] book index failed for', subject, chapter, err);
  }
  return valid;
}

const BOOK_SHAPE = `Return ONLY this JSON object, no prose and no markdown fences:
{
  "title": string,           // handbook title
  "summary": string,         // 1-2 sentences on what the handbook covers
  "chapters": [              // ordered; each chapter becomes one slide
    {
      "title": string,
      "points": [string, ...],          // every concept/fact/example that chapter must teach
      "source_page": number,            // reference page it came from (omit when built from a topic)
      "layout": [ { "type": "heading"|"paragraph"|"bullets"|"sidebox"|"table"|"code"|"diagram"|"callout"|"qa",
                    "note": string } ]  // that page's block sequence, top to bottom (omit when built from a topic)
    }
  ]
}
Points are the syllabus: each is a specific teachable item (a definition, a method, a complexity, a gotcha, a code example, a comparison row) — not a vague heading. Aim for 11-13 points per chapter: that is what one dense handwritten page holds.`;

/**
 * A chapter becomes a page and a part holds ${MAX_SLIDES} pages, so a book longer than that
 * guarantees a spillover part nobody asked for. Depth goes into points per chapter instead.
 */
/** Measured over 60 chapters: one rendered page carries about 12.6 book points. */
const POINTS_PER_PAGE = 12;

const PART_BUDGET = `SIZE — both limits are hard:
- at most ${MAX_SLIDES} chapters, because one carousel part holds ${MAX_SLIDES} pages and a chapter is a page;
- at most ${MAX_SLIDES * POINTS_PER_PAGE} points in the whole book, because a page holds about ${POINTS_PER_PAGE} of them.
That is about ${POINTS_PER_PAGE} points per chapter. Going over does not add depth — it spills the
chapter into a second post. Cut the weakest points instead, and keep the ones that teach something
specific.`;

async function generateBook(prompt: string, allowedTools?: string[]): Promise<Book> {
  const first = await runClaude(prompt, { timeoutMs: 900_000, allowedTools });
  try {
    return BookSchema.parse(extractJson(first));
  } catch (err) {
    const retry = await runClaude(
      `${prompt}\n\nYour previous output failed validation: ${String(err).slice(0, 500)}. Return corrected JSON only.`,
      { timeoutMs: 900_000, allowedTools }
    );
    return BookSchema.parse(extractJson(retry));
  }
}

export async function bookFromReferences(subject: string, chapter: string, files: string[]): Promise<Book> {
  const prompt = [
    'You are building the syllabus for a tech handbook that will be published as an Instagram carousel of handwritten notes pages.',
    'Reference pages are saved at these paths — READ AND LOOK AT EVERY ONE with the Read tool before answering. Do not skip any:',
    files.map((f) => `- ${f}`).join('\n'),
    'Work page by page. ONE CHAPTER PER REFERENCE PAGE, in the same order, so our page N mirrors their page N.',
    'For each page capture two things:',
    '1. "points" — every concept, table row, comparison, code example, complexity fact, gotcha and tip that page teaches. Miss nothing; this is the contract for what must be rendered.',
    '2. "layout" — the block sequence that page actually uses, read top to bottom, as {type, note} pairs. Types: heading, paragraph, bullets, sidebox, table, code, diagram, callout, qa. The note says what that block holds ("comparison table: structure/ordered/mutable/use case", "green box: why data structures", "interview tip callout"). Include EVERY block on the page, including its tables, boxes and code snippets.',
    'Also set "source_page" to the reference page number (1-based).',
    'Keep the references\' depth: they pack a dense page per topic.',
    BOOK_SHAPE,
  ].join('\n\n');
  return saveBook(subject, chapter, await generateBook(prompt, ['Read']));
}

export async function bookFromTopic(subject: string, chapter: string, topic: string): Promise<Book> {
  const prompt = [
    'You are building the syllabus for a tech handbook published as an Instagram carousel of dense handwritten notes pages.',
    `Topic: ${topic}`,
    'Cover the topic thoroughly, the way a strong study-notes series would: fundamentals, mechanics/internals, practical usage, comparisons, complexity or trade-offs, common mistakes, and a closing summary.',
    PART_BUDGET,
    BOOK_SHAPE,
  ].join('\n\n');
  return saveBook(subject, chapter, await generateBook(prompt));
}

export async function reviseBook(subject: string, chapter: string, book: Book, request: string): Promise<Book> {
  const prompt = [
    'You maintain the syllabus (book) for a tech handbook carousel.',
    'Current book JSON:',
    JSON.stringify(book),
    'User request:',
    request,
    'Apply the request. Keep everything else unchanged.',
    BOOK_SHAPE,
  ].join('\n\n');
  return generateBook(prompt);
}
