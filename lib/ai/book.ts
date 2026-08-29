import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import { postDir } from '../store';
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
      })
    )
    .min(1),
});

export type Book = z.infer<typeof BookSchema>;

export function bookPath(slug: string) {
  return path.join(postDir(slug), 'book.json');
}

export async function loadBook(slug: string): Promise<Book | null> {
  try {
    return BookSchema.parse(JSON.parse(await fs.readFile(bookPath(slug), 'utf8')));
  } catch {
    return null;
  }
}

export async function saveBook(slug: string, book: Book): Promise<Book> {
  const valid = BookSchema.parse(book);
  await fs.mkdir(postDir(slug), { recursive: true });
  await fs.writeFile(bookPath(slug), JSON.stringify(valid, null, 2));
  try {
    const { syncBook } = await import('../graph');
    syncBook(slug, valid);
  } catch (err) {
    console.warn('[iolar] book index failed for', slug, err);
  }
  return valid;
}

const BOOK_SHAPE = `Return ONLY this JSON object, no prose and no markdown fences:
{
  "title": string,           // handbook title
  "summary": string,         // 1-2 sentences on what the handbook covers
  "chapters": [              // ordered; each chapter becomes roughly one slide
    { "title": string, "points": [string, ...] }   // points = every concept/fact/example that chapter must teach
  ]
}
Points are the syllabus: each is a specific teachable item (a definition, a method, a complexity, a gotcha, a code example, a comparison row) — not a vague heading. Aim for 6-12 points per chapter so a chapter fills a dense handwritten page.`;

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

export async function bookFromReferences(slug: string, files: string[]): Promise<Book> {
  const prompt = [
    'You are building the syllabus for a tech handbook that will be published as an Instagram carousel of handwritten notes pages.',
    'Reference pages are saved at these paths — READ AND LOOK AT EVERY ONE with the Read tool before answering. Do not skip any:',
    files.map((f) => `- ${f}`).join('\n'),
    'Extract the COMPLETE topic coverage of the references: every concept, table, comparison, code example, complexity fact, gotcha and tip they teach, in their order. Miss nothing — this syllabus is the contract for what the generated pages must cover.',
    'Then organise it into chapters. Keep the references\' depth: they pack a dense page per topic.',
    BOOK_SHAPE,
  ].join('\n\n');
  return saveBook(slug, await generateBook(prompt, ['Read']));
}

export async function bookFromTopic(slug: string, topic: string): Promise<Book> {
  const prompt = [
    'You are building the syllabus for a tech handbook published as an Instagram carousel of dense handwritten notes pages.',
    `Topic: ${topic}`,
    'Cover the topic thoroughly, the way a strong study-notes series would: fundamentals, mechanics/internals, practical usage, comparisons, complexity or trade-offs, common mistakes, and a closing summary.',
    BOOK_SHAPE,
  ].join('\n\n');
  return saveBook(slug, await generateBook(prompt));
}

export async function reviseBook(slug: string, book: Book, request: string): Promise<Book> {
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
