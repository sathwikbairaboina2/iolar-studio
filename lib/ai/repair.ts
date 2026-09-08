import { Post, validatePost } from '../schema';
import { listParts, loadPost, savePost } from '../store';
import { loadBook } from './book';
import { uncoveredPoints } from './fit';
import { thinker } from './runner';
import { PRESERVE_RULE, SCHEMA_RULES } from './rules';
import { extractJson } from './revise';

export type Repair = { part: number; missingBefore: number; missingAfter: number; recovered: string[] };

/** All parts of a chapter read as one post, which is the scope coverage is judged at. */
async function mergedChapter(subject: string, chapter: string): Promise<Post> {
  const parts = await listParts(subject, chapter);
  const posts = await Promise.all(parts.map((p) => loadPost(subject, chapter, p)));
  return { ...posts[0], slides: posts.flatMap((p) => p.slides) };
}

export async function chapterGaps(subject: string, chapter: string): Promise<string[]> {
  const book = await loadBook(subject, chapter);
  if (!book) return [];
  return uncoveredPoints(book, await mergedChapter(subject, chapter));
}

/**
 * Restores book points a chapter no longer covers by ADDING pages to its last part.
 *
 * This exists because content loss is possible at all: a part could be overwritten, a
 * revision could drop material. The book is the record of what the chapter promised, so
 * anything in it that the pages no longer say is a gap to fill, never a decision to trim.
 * The proposal is rejected unless it strictly adds.
 */
export async function repairCoverage(
  subject: string,
  chapter: string,
  opts: { timeoutMs?: number } = {}
): Promise<Repair | null> {
  const book = await loadBook(subject, chapter);
  if (!book) return null;

  const missing = uncoveredPoints(book, await mergedChapter(subject, chapter));
  if (!missing.length) return null;

  const parts = await listParts(subject, chapter);
  const part = parts[parts.length - 1];
  const post = await loadPost(subject, chapter, part);

  const prompt = [
    'You are restoring material that was lost from a handwritten-notes carousel.',
    'These book points are no longer covered anywhere in the chapter. Add pages to the END of this post so every one of them is taught:',
    missing.map((m) => `- ${m}`).join('\n'),
    'NEVER remove, shorten or reword existing content. Every page, block, bullet, table row and code line already present must survive VERBATIM, in the same order. You may only APPEND new slides and blocks.',
    'New pages follow the existing house style: 12-16 short blocks per page, numbered section headings, bullets of one line each (max 12 words), table cells of 1-3 words, code lines under 34 characters.',
    PRESERVE_RULE,
    'Current post JSON:',
    JSON.stringify(post),
    SCHEMA_RULES,
    'Return ONLY the complete updated post JSON, no prose and no markdown fences.',
  ].join('\n\n');

  const proposal = validatePost(extractJson(await thinker()(prompt, { timeoutMs: opts.timeoutMs ?? 900_000 })));

  if (proposal.slides.length < post.slides.length) {
    throw new Error(`repair dropped pages (${post.slides.length} -> ${proposal.slides.length}) — rejected`);
  }
  const before = post.slides.reduce((n, s) => n + s.blocks.length, 0);
  const after = proposal.slides.reduce((n, s) => n + s.blocks.length, 0);
  if (after < before) {
    throw new Error(`repair removed content (${before} blocks -> ${after}) — rejected; it may only add`);
  }

  await savePost(subject, chapter, part, proposal);

  const stillMissing = uncoveredPoints(book, await mergedChapter(subject, chapter));
  const recovered = missing.filter((m) => !stillMissing.includes(m));

  // A repair that recovers nothing is not worth the pages it added.
  if (!recovered.length) {
    await savePost(subject, chapter, part, post);
    throw new Error('repair covered none of the missing points — reverted');
  }

  return { part, missingBefore: missing.length, missingAfter: stillMissing.length, recovered };
}
