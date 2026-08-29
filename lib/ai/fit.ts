import path from 'path';
import { Post, validatePost } from '../schema';
import { loadPost } from '../store';
import { partDir } from '../paths';
import { renderSlide, mergeContinuations } from '../renderer/capture';
import { Book, loadBook } from './book';
import { runClaude } from './claude';
import { extractJson } from './revise';

export type SlideFit = { slide: number; neededPct: number };

const STOP = new Set(
  'the a an and or of to in for with is are its it you your how what why when use using python vs on at be by as that this from can will not no'.split(' ')
);

function pointKeywords(point: string): string[] {
  return (point.toLowerCase().match(/[a-z_][a-z0-9_().]{2,}/g) ?? [])
    .filter((w) => !STOP.has(w))
    .slice(0, 6);
}

function postText(post: Post): string {
  const parts: string[] = [];
  for (const s of post.slides) {
    parts.push(s.page_title);
    for (const b of s.blocks) {
      if ('text' in b) parts.push(b.text);
      if ('title' in b) parts.push(b.title);
      if ('q' in b) parts.push(b.q);
      if ('items' in b) parts.push(...b.items);
      if ('lines' in b) parts.push(...b.lines);
      if ('a_bullets' in b) parts.push(...b.a_bullets);
      if ('example_code' in b && b.example_code) parts.push(...b.example_code);
      if (b.type === 'table') {
        parts.push(...b.headers);
        for (const row of b.rows) parts.push(...row);
      }
    }
  }
  return parts.join(' ').toLowerCase();
}

/** Book points whose keywords no longer appear in the post — i.e. content that was dropped. */
export function uncoveredPoints(book: Book, post: Post): string[] {
  const body = postText(post);
  const missing: string[] = [];
  for (const ch of book.chapters) {
    for (const p of ch.points) {
      const kws = pointKeywords(p);
      if (!kws.length) continue;
      const hits = kws.filter((w) => body.includes(w.replace(/[().]/g, ''))).length;
      if (hits / kws.length < 0.5) missing.push(p);
    }
  }
  return missing;
}

/** How much of one page each authored slide needs. Over 100% spills onto the next page. */
export async function measureSlides(post: Post): Promise<SlideFit[]> {
  const out: SlideFit[] = [];
  const dir = path.join(partDir('.measure', 'tmp', 1));
  for (let i = 0; i < post.slides.length; i++) {
    const r = await renderSlide(post, i, path.join(dir, `m-${i}.png`));
    out.push({ slide: i + 1, neededPct: r.neededPct });
  }
  return out;
}

/**
 * Fills thin pages toward ~95% by pulling MORE material from the book. It never trims:
 * a proposal that drops any book point is rejected. Over-full pages are left alone —
 * the renderer spills them onto the next page, and content that runs past the carousel
 * belongs in a follow-up post, not in the bin.
 */
export async function fitToPages(
  subject: string, chapter: string, part: number
): Promise<{ proposal: Post; before: SlideFit[] }> {
  const post = { ...(await loadPost(subject, chapter, part)) };
  post.slides = mergeContinuations(post.slides);

  const before = await measureSlides(post);
  const book = await loadBook(subject, chapter);
  const under = before.filter((m) => m.neededPct < 92);
  if (!under.length) return { proposal: post, before };

  const prompt = [
    'You are filling out a handwritten-notes carousel so every page is nearly full.',
    'The pages were rendered and measured. Target 92-98% of one page each.',
    `These pages leave space empty — add genuinely useful material until each reaches about 95%: another numbered section, more table rows, a worked example, a tip callout:\n${under
      .map((m) => `- slide ${m.slide}: fills only ${m.neededPct}% of a page`)
      .join('\n')}`,
    'NEVER remove or shorten existing content. Every fact, bullet, table row and code line that is already there must survive verbatim. You may only ADD.',
    'Do not change the number of slides. Keep the numbered section structure and the study-notes voice.',
    'New blocks stay short: bullets one line each, table cells 1-3 words, code lines under 45 characters.',
    book ? `Draw the added material from this book (syllabus), preferring points that are currently thin:\n${JSON.stringify(book)}` : '',
    'Current post JSON:',
    JSON.stringify(post),
    'Return ONLY the complete updated post JSON, no prose and no markdown fences.',
  ].filter(Boolean).join('\n\n');

  const out = await runClaude(prompt, { timeoutMs: 900_000 });
  const proposal = validatePost(extractJson(out));

  if (proposal.slides.length !== post.slides.length) {
    throw new Error('fit pass changed the slide count — rejected');
  }

  // The fit pass may only ADD. Counting blocks catches deletions that a keyword check
  // misses, because dropped material often shares vocabulary with what survives.
  const blocksBefore = post.slides.reduce((n, s) => n + s.blocks.length, 0);
  const blocksAfter = proposal.slides.reduce((n, s) => n + s.blocks.length, 0);
  if (blocksAfter < blocksBefore) {
    throw new Error(
      `fit pass removed content (${blocksBefore} blocks -> ${blocksAfter}) — rejected; it may only add`
    );
  }
  if (book) {
    // Hard gate: the fit pass may only add. Anything the book covered must still be covered.
    const lostNow = uncoveredPoints(book, proposal);
    const lostBefore = uncoveredPoints(book, post);
    const dropped = lostNow.filter((p) => !lostBefore.includes(p));
    if (dropped.length) {
      throw new Error(
        `fit pass dropped ${dropped.length} book point(s) — rejected. First: ${dropped[0].slice(0, 80)}`
      );
    }
  }
  return { proposal, before };
}
