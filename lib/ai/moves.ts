import type { Post } from '../schema';
import type { Finding } from '../verify/gates';
import { thinker } from './runner';

/**
 * Moving content between or within pages, without rewriting any of it.
 *
 * Most pedagogy findings are about order: a term used a page before it is introduced, a
 * callout ahead of the section it comments on. `revisePost` rewrites one slide, so it cannot
 * carry a block to another page, and asking a model to re-emit whole pages to move one block
 * is how content gets dropped. Here the model — or a rule — only names the moves, and code
 * applies them. A block can be moved but never created, edited or deleted.
 */

/** Pages are 1-based like findings; block positions are 0-based. `expect` is text the block must contain. */
export type Move = { from: { page: number; block: number }; to: { page: number; index: number }; expect: string };

const describeBlock = (b: unknown) => JSON.stringify(b);

/** Applies the moves in order — each one's positions refer to the post after the moves before it. */
export function applyMoves(post: Post, moves: Move[]): Post {
  const out: Post = structuredClone(post);
  for (const [n, m] of moves.entries()) {
    const src = out.slides[m.from.page - 1];
    const block = src?.blocks[m.from.block];
    if (!block) throw new Error(`move ${n + 1}: no block at page ${m.from.page} block ${m.from.block}`);
    if (!m.expect || !describeBlock(block).includes(JSON.stringify(m.expect).slice(1, -1))) {
      throw new Error(`move ${n + 1}: page ${m.from.page} block ${m.from.block} does not contain ${JSON.stringify(m.expect)}`);
    }
    const dst = out.slides[m.to.page - 1];
    if (!dst) throw new Error(`move ${n + 1}: there is no page ${m.to.page}`);
    src.blocks.splice(m.from.block, 1);
    if (m.to.index < 0 || m.to.index > dst.blocks.length) {
      throw new Error(`move ${n + 1}: index ${m.to.index} is outside page ${m.to.page}`);
    }
    dst.blocks.splice(m.to.index, 0, block);
  }
  if (out.slides.some((s) => !s.blocks.length)) throw new Error('the moves would leave a page empty');
  return out;
}

/** The deterministic fix for a `heading.stranded` gate finding: the heading opens the next page. */
export function strandedHeadingMove(post: Post, f: Finding): Move | null {
  const page = post.slides[f.page - 1];
  const block = f.block ?? -1;
  const b = page?.blocks[block];
  if (!b || b.type !== 'heading' || block !== page.blocks.length - 1 || !post.slides[f.page]) return null;
  return { from: { page: f.page, block }, to: { page: f.page + 1, index: 0 }, expect: b.text };
}

/** A finding whose fix is to move content rather than change it. */
export function isPositional(f: Finding): boolean {
  if (f.rule === 'heading.stranded') return true;
  return /^\s*(move|put|place|reorder|swap)\b/i.test(f.fix) || /\bmove (this|the|it|that)\b/i.test(f.fix);
}

function outline(post: Post): string {
  return post.slides.map((s, i) => [
    `Page ${i + 1}: ${s.page_title}`,
    ...s.blocks.map((b, j) => `  block ${j}: ${describeBlock(b).slice(0, 160)}`),
  ].join('\n')).join('\n');
}

function extractArray(s: string): unknown {
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start === -1 || end <= start) throw new Error('no JSON array in AI output');
  return JSON.parse(s.slice(start, end + 1));
}

function prompt(post: Post, f: Finding, error?: string) {
  return [
    'A review of a handwritten-notes carousel found content in the wrong place. Fix it ONLY by moving existing blocks.',
    'You cannot edit, add or delete any block — only move them. If the finding cannot be fixed by moving blocks, return [].',
    'Return ONLY a JSON array of moves: [{"from":{"page":P,"block":B},"to":{"page":P2,"index":I},"expect":"short exact text from the moved block"}]',
    'Pages are 1-based, blocks 0-based. Moves apply in order, and each one\'s positions refer to the post AFTER the moves before it.',
    '`to.index` is the position the block takes on the destination page after it has been removed from its source.',
    error ? `Your previous plan failed: ${error}. Fix it.` : '',
    `Finding (page ${f.page}): ${f.summary}`,
    f.evidence ? `Evidence: ${f.evidence}` : '',
    `Required change: ${f.fix}`,
    'Pages:',
    outline(post),
  ].filter(Boolean).join('\n\n');
}

/** Asks the model for a move plan and applies it; one retry with the error that sank the first. */
export async function proposeMoves(post: Post, f: Finding): Promise<{ moves: Move[]; post: Post }> {
  let error: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await thinker()(prompt(post, f, error), { timeoutMs: 300_000 });
    try {
      const moves = extractArray(out) as Move[];
      if (!Array.isArray(moves)) throw new Error('the plan is not an array');
      return { moves, post: applyMoves(post, moves) };
    } catch (err) {
      error = String(err).slice(0, 300);
    }
  }
  throw new Error(`no usable move plan: ${error}`);
}
