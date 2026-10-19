import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import { MAX_SLIDES, BOOK_PAGES } from '../schema';
import { bookFile, chapterDir } from '../paths';
import { thinker } from './runner';
import { extractJson } from './revise';
import { categoryOf } from '../handbookCategories';

/** The chapter's category, cut into the book prompt: what a chapter is and the shape every page takes. */
export async function categoryBookRules(subject: string, chapter: string): Promise<string> {
  const { chapterCategory } = await import('../store');
  const c = categoryOf(await chapterCategory(subject, chapter).catch(() => undefined));
  return [
    `CATEGORY "${c.name}": each chapter is ${c.content.unit}. ${c.content.bookGuidance}`,
    `Every item chapter's "shape" is: ${c.content.pageShape.join(' → ')}. A cover chapter is shaped ["cover"]; intro and closing chapters (requirements, architecture, summary, cheatsheet) get shapes of their own.`,
    `Rules: ${c.content.rules.join(' ')}`,
  ].join('\n');
}

export const BookSchema = z.object({
  title: z.string(),
  summary: z.string(),
  /** Drills only: the one schema and every sample row all the tasks run against. */
  dataset: z
    .object({
      tables: z.array(z.object({ name: z.string(), columns: z.array(z.string()), rows: z.array(z.array(z.string())) })).min(1),
    })
    .optional(),
  chapters: z
    .array(
      z.object({
        title: z.string(),
        points: z.array(z.string()).min(1),
        /** Which reference page this chapter was read from (1-based), when built from references. */
        source_page: z.number().int().optional(),
        /** Section roles for a chapter built from a topic (definition, mechanism, example, comparison, mistakes, summary, cheatsheet, cover). */
        shape: z.array(z.string()).optional(),
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

/**
 * A drills chapter runs every task on one dataset, or each page invents rows of its own and the
 * results contradict each other. Returned for a drills chapter whose book carries one, else empty,
 * so the other categories' prompts never see it.
 */
export function datasetRules(book: Book, category?: string): string {
  if (category !== 'drills' || !book.dataset) return '';
  const tables = book.dataset.tables
    .map((t) => `${t.name}(${t.columns.join(', ')})\n${t.rows.map((r) => `  ${r.join(' | ')}`).join('\n')}`)
    .join('\n');
  return [
    'SAMPLE DATASET for the whole chapter:',
    tables,
    'Use ONLY these tables and rows. Every result is computed from exactly these rows; never invent names, ids or values. The intro or schema page shows this dataset in full.',
  ].join('\n');
}

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
    (await import('../handbookIndex')).indexBook(subject, chapter, valid);
    const { syncBook } = await import('../knowledge/spaces/handbooks');
    await syncBook(subject, chapter, valid);
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
      "shape": [string, ...],           // section roles in order, from: definition, mechanism, example, comparison, mistakes, summary, cheatsheet, cover (built from a topic)
      "source_page": number,            // reference page it came from (omit when built from a topic)
      "layout": [ { "type": "heading"|"paragraph"|"bullets"|"sidebox"|"table"|"code"|"diagram"|"callout"|"qa",
                    "note": string } ]  // that page's block sequence, top to bottom (omit when built from a topic)
    }
  ]
}
Points are the syllabus: each is a specific teachable item (a definition, a method, a complexity, a gotcha, a code example, a comparison row) — not a vague heading. Points per chapter follow the SIZE budget; each point is one must-remember fact, command, rule or gotcha. No history, motivation or "why learn X" points.`;

/** Asked for in a drills book only: the single schema and sample rows every task runs on. */
const DATASET_SHAPE = `Also add a top-level "dataset": the full schema and EVERY sample row the tasks will use, as
{ "dataset": { "tables": [ { "name": string, "columns": [string, ...], "rows": [[string, ...], ...] } ] } }
Keep it small: at most about 8 rows per table, only the tables the tasks need. Every task is written and answered against exactly these rows, so make them rich enough for joins, aggregates and subqueries to return real results.`;

/** Measured over 60 chapters: one rendered page carries about 12.6 book points. */
const POINTS_PER_PAGE = 12;

/**
 * The category passes its own numbers (notebook pages hold far fewer points than study-sheet ones);
 * without one the globals apply.
 *
 * A chapter becomes a page and a part holds MAX_SLIDES pages, so a book longer than that
 * guarantees a spillover part nobody asked for. It aims at BOOK_PAGES, below the limit, so
 * the pages polish grows have room. Depth goes into points per chapter instead.
 */
export function partBudget(pointsPerPage = POINTS_PER_PAGE, bookPages = BOOK_PAGES): string {
  return `SIZE — both limits are hard:
- at most ${bookPages} chapters, because one carousel holds ${MAX_SLIDES} pages, a chapter is a page, and polishing grows some pages;
- at most ${bookPages * pointsPerPage} points in the whole book, because a page holds about ${pointsPerPage} of them.
That is about ${pointsPerPage} points per chapter. Going over does not add depth — it spills the
chapter into a second post. Cut the weakest points instead, and keep the ones that teach something
specific.`;
}

async function generateBook(prompt: string, allowedTools?: string[], needsTools?: string): Promise<Book> {
  const first = await thinker({ needsTools })(prompt, { timeoutMs: 900_000, allowedTools });
  try {
    return BookSchema.parse(extractJson(first));
  } catch (err) {
    const retry = await thinker()(
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
  return saveBook(subject, chapter, await generateBook(prompt, ['Read'], 'reading reference pages'));
}

export async function bookFromTopic(subject: string, chapter: string, topic: string): Promise<Book> {
  const { chapterCategory: categoryId } = await import('../store');
  const category = categoryOf(await categoryId(subject, chapter).catch(() => undefined));
  const prompt = [
    'You are building the syllabus for a tech handbook published as an Instagram carousel of dense handwritten notes pages.',
    `Topic: ${topic}`,
    category.id === 'handbook'
      ? 'Write quick revision notes. Cover the topic end to end once, in this order: what it is and the mental model, the core workflow, everyday commands or usage, the common mistakes, and a cheat sheet last. Keep only what a learner revises the night before; skip anything obvious or rarely used.'
      : 'Cover the topic thoroughly, the way a strong study-notes series would: fundamentals, mechanics/internals, practical usage, comparisons, complexity or trade-offs, common mistakes, and a closing summary.',
    'Give every chapter a "shape": the ordered section roles its page should have (definition, mechanism, example, comparison, mistakes, summary, cheatsheet). A platform or service family (AWS, Docker, Kubernetes) starts with a chapter shaped ["cover"], whose points are short labels (a few words each) for what the handbook covers, with every teaching point in a later chapter; the last chapter of any series is shaped ["cheatsheet"].',
    await categoryBookRules(subject, chapter),
    partBudget(category.presentation.pointsPerPage, category.presentation.bookPages),
    category.id === 'drills' ? DATASET_SHAPE : '',
    BOOK_SHAPE,
  ].filter(Boolean).join('\n\n');
  let book = await generateBook(prompt);
  // The category's book rules are checkable: a count the title promises, no repeated page or
  // item. A book that breaks them gets one regeneration told exactly what broke; what comes back
  // is kept either way, and the review reports anything still wrong.
  const { chapterCategory } = await import('../store');
  const { bookGates } = await import('../verify/categoryGates');
  const broken = bookGates(book, await chapterCategory(subject, chapter).catch(() => undefined));
  if (broken.length) {
    book = await generateBook(`${prompt}\n\nYour previous book broke these rules. Fix every one and return the whole corrected book:\n${broken
      .map((f) => `- ${f.summary} ${f.fix}`).join('\n')}\nPrevious book:\n${JSON.stringify(book)}`);
  }
  return saveBook(subject, chapter, book);
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
  const revised = await generateBook(prompt);
  // The dataset is the chapter's fixed ground: a revision that leaves it out has not removed it.
  return book.dataset && !revised.dataset ? { ...revised, dataset: book.dataset } : revised;
}
