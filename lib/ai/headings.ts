import { Post, validatePost } from '../schema';
import { loadPost } from '../store';
import { thinker } from './runner';
import { extractJson } from './revise';
import { PRESERVE_RULE } from './rules';

/**
 * After auto-flow splits a page, continuation pages carry a "(cont.)" placeholder title.
 * This rewrites the affected titles so the sequence reads like a designed handbook.
 * Returns a proposal; saving is the caller's decision.
 */
export async function fixHeadings(subject: string, chapter: string, part: number): Promise<Post> {
  const post = await loadPost(subject, chapter, part);
  const titles = post.slides.map((s, i) => `${i + 1}. ${s.page_title}`).join('\n');
  const prompt = [
    'A handwritten-notes carousel was reflowed, so some pages were split and carry "(cont.)" placeholder titles.',
    'Rewrite ONLY the page_title of each slide so the sequence reads as a deliberate handbook: a split pair becomes two distinct, specific titles describing what is actually on each page (for example "Python Lists" and "List Methods & Slicing"), never "(cont.)".',
    'Change nothing else — every block must stay byte-identical, and the slide count must not change.',
    PRESERVE_RULE,
    'Current titles:',
    titles,
    'Current post JSON:',
    JSON.stringify(post),
    'Return ONLY the complete updated post JSON, no prose and no markdown fences.',
  ].join('\n\n');

  const out = await thinker()(prompt, { timeoutMs: 300_000 });
  const proposal = validatePost(extractJson(out));
  if (proposal.slides.length !== post.slides.length) {
    throw new Error('heading pass changed the slide count — rejected');
  }
  // A page that got its own title is its own chapter now, so the continuation flag has to go:
  // renderAll merges every slide still flagged `cont` back into the page before it, which would
  // re-split it and put "(cont.)" straight back — the rename could never survive one reflow.
  // Blocks still flow across chapter boundaries, so the pages rebalance either way.
  proposal.slides = proposal.slides.map((s, i) => {
    const stillContinuation = / \(cont\.\)$/.test(s.page_title);
    return stillContinuation ? { ...s, cont: post.slides[i].cont } : { ...s, cont: undefined };
  });
  return proposal;
}
