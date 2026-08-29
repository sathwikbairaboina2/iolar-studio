import path from 'path';
import { Post, validatePost } from '../schema';
import { loadPost, postDir } from '../store';
import { renderSlide } from '../renderer/capture';
import { loadBook } from './book';
import { runClaude } from './claude';
import { extractJson } from './revise';

export type SlideFit = { slide: number; neededPct: number };

/**
 * Measures how much of one page each authored slide actually needs. Over 100% means the
 * slide will be split across pages; well under means wasted space.
 */
export async function measureSlides(post: Post): Promise<SlideFit[]> {
  const out: SlideFit[] = [];
  const dir = path.join(postDir('.measure'), 'tmp');
  for (let i = 0; i < post.slides.length; i++) {
    const r = await renderSlide(post, i, path.join(dir, `m-${i}.png`));
    out.push({ slide: i + 1, neededPct: r.neededPct });
  }
  return out;
}

/**
 * One AI pass that resizes slides to the page: over-full slides lose words, thin slides
 * gain material from the book. Returns a proposal; the caller decides to save it.
 */
export async function fitToPages(slug: string): Promise<{ proposal: Post; before: SlideFit[] }> {
  const post = await loadPost(slug);
  const before = await measureSlides(post);
  const book = await loadBook(slug);

  const over = before.filter((m) => m.neededPct > 104);
  const under = before.filter((m) => m.neededPct < 85);

  const lines = [
    over.length
      ? `These slides do not fit on one page and will be split, wasting space. Cut their content by the stated amount — shorten wording, merge bullets, drop table columns that repeat, trim code comments. Keep every concept, just say it in fewer words:\n${over
          .map((m) => `- slide ${m.slide}: needs ${m.neededPct}% of a page, cut about ${m.neededPct - 96}%`)
          .join('\n')}`
      : '',
    under.length
      ? `These slides leave the page half empty. Add genuinely useful material — another numbered section, more table rows, an extra short example:\n${under
          .map((m) => `- slide ${m.slide}: fills only ${m.neededPct}% of a page`)
          .join('\n')}`
      : '',
  ].filter(Boolean);

  if (!lines.length) return { proposal: post, before };

  const prompt = [
    'You are fitting a handwritten-notes carousel so every page is nearly full but never overflows.',
    'The pages were rendered and measured. Aim each slide at 92-100% of one page.',
    ...lines,
    'Do not change the number of slides. Keep the numbered section structure and the study-notes voice.',
    'Blocks stay short: bullets one line each, table cells 1-3 words, code lines under 45 characters.',
    book ? `The book (syllabus) this post must cover:\n${JSON.stringify(book)}` : '',
    'Current post JSON:',
    JSON.stringify(post),
    'Return ONLY the complete updated post JSON, no prose and no markdown fences.',
  ].filter(Boolean).join('\n\n');

  const out = await runClaude(prompt, { timeoutMs: 900_000 });
  const proposal = validatePost(extractJson(out));
  if (proposal.slides.length !== post.slides.length) {
    throw new Error('fit pass changed the slide count — rejected');
  }
  return { proposal, before };
}
