import type { Block, Post } from '../schema';
import { listParts, loadPost, savePost, chapterCategory } from '../store';
import { categoryOf } from '../handbookCategories';

const Q_PREFIX = /^Q(\d+)\.\s/;
const Q_RANGE = /Q(\d+)(\s*[-–]\s*)(\d+)/g;

/** Where a heading or question carries a "Q<n>. " prefix, the text that holds it. */
const questionText = (b: Block): string | null =>
  b.type === 'heading' ? b.text : b.type === 'qa' ? b.q : null;

/**
 * Item numbers are the model's to write and nobody checks them: a listicle read 1,3,3,4,6 and a
 * drill set started at Q7. They are deterministic, so they are set here, in page order from
 * `start`. `concept` blocks take consecutive numbers; "Q<n>." headings and questions are
 * renumbered in order of first appearance (a number written twice stays one number). A "Q<a>-<b>" range in a page title is rewritten to the
 * min and max item number on that page, and removed when the page has none. `next` is the first free number.
 */
export function renumberItems(post: Post, start: number): { post: Post; next: number } {
  let concepts = 0;
  const map = new Map<number, number>();
  const slides = post.slides.map((s) => ({
    ...s,
    blocks: s.blocks.map((b): Block => {
      if (b.type === 'concept') return { ...b, number: start + concepts++ };
      const text = questionText(b);
      const m = text?.match(Q_PREFIX);
      // "Q29 again with CASE" points back at a question already numbered: it follows its number.
      const again = !m && text?.match(/^Q(\d+)\b(?!\.\s)/);
      if (text && again && map.has(Number(again[1]))) {
        const fixed = text.replace(/^Q\d+/, `Q${map.get(Number(again[1]))}`);
        return b.type === 'heading' ? { ...b, text: fixed } : b.type === 'qa' ? { ...b, q: fixed } : b;
      }
      if (!text || !m) return b;
      const old = Number(m[1]);
      if (!map.has(old)) { map.set(old, start + map.size); }
      const fixed = text.replace(Q_PREFIX, `Q${map.get(old)}. `);
      return b.type === 'heading' ? { ...b, text: fixed } : b.type === 'qa' ? { ...b, q: fixed } : b;
    }),
  }));
  // A title's range is measured from its page, never mapped: the model's numbers are not trusted.
  const titled = slides.map((s) => {
    if (!new RegExp(Q_RANGE.source).test(s.page_title)) return s;
    const ns = s.blocks.map((b) => Number(questionText(b)?.match(Q_PREFIX)?.[1])).filter((n) => n > 0);
    if (ns.length) {
      const lo = Math.min(...ns);
      const hi = Math.max(...ns);
      return { ...s, page_title: s.page_title.replace(Q_RANGE, (_m, _a, dash) => `Q${lo}${dash}${hi}`) };
    }
    // No items on the page: the range goes, with its brackets and the space before them.
    const bare = s.page_title
      .replace(new RegExp(`\\s*[(\\[]\\s*${Q_RANGE.source}\\s*[)\\]]`, 'g'), '')
      .replace(Q_RANGE, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return { ...s, page_title: bare || s.page_title };
  });
  return { post: { ...post, slides: titled }, next: start + Math.max(concepts, map.size) };
}

/** The highest item number a post carries, 0 when it has none. */
export function lastItemNumber(post: Post): number {
  let last = 0;
  for (const s of post.slides) {
    for (const b of s.blocks) {
      if (b.type === 'concept') last = Math.max(last, b.number);
      else last = Math.max(last, Number((questionText(b)?.match(Q_PREFIX) ?? [])[1] ?? 0));
    }
  }
  return last;
}

/**
 * Renumbers a saved part: from 1 for part 1, otherwise one past the last number of the part
 * before. Runs for categories whose numbering runs on and for any post with concept blocks;
 * any other post is returned as saved. Saves only when something changed.
 */
export async function applyNumbering(subject: string, chapter: string, part: number): Promise<Post> {
  const post = await loadPost(subject, chapter, part);
  const category = categoryOf(await chapterCategory(subject, chapter).catch(() => undefined));
  const hasConcepts = post.slides.some((s) => s.blocks.some((b) => b.type === 'concept'));
  if (category.presentation.numbering !== 'continuous' && !hasConcepts) return post;
  let start = 1;
  for (const n of (await listParts(subject, chapter)).filter((p) => p < part).sort((a, b) => b - a)) {
    const prev = await loadPost(subject, chapter, n).catch(() => null);
    const last = prev ? lastItemNumber(prev) : 0;
    if (last) { start = last + 1; break; }
  }
  const out = renumberItems(post, start).post;
  if (JSON.stringify(out) !== JSON.stringify(post)) await savePost(subject, chapter, part, out);
  return out;
}
