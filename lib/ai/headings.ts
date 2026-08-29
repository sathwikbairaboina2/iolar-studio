import { Post, validatePost } from '../schema';
import { loadPost } from '../store';
import { runClaude } from './claude';
import { extractJson } from './revise';

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
    'Current titles:',
    titles,
    'Current post JSON:',
    JSON.stringify(post),
    'Return ONLY the complete updated post JSON, no prose and no markdown fences.',
  ].join('\n\n');

  const out = await runClaude(prompt, { timeoutMs: 300_000 });
  const proposal = validatePost(extractJson(out));
  if (proposal.slides.length !== post.slides.length) {
    throw new Error('heading pass changed the slide count — rejected');
  }
  // Titles change; split provenance must not, or a later re-render cannot rebalance the chain.
  proposal.slides = proposal.slides.map((s, i) => ({ ...s, cont: post.slides[i].cont }));
  return proposal;
}
