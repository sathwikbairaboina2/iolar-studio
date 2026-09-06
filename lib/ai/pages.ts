import { Post, Slide, validatePost, validateSlide } from '../schema';
import { getSettings } from '../settings';
import { loadPost, savePost } from '../store';
import { thinker, Runner } from './runner';
import { extractJson } from './revise';
import { Book, loadBook } from './book';
import { SCHEMA_RULES, RECIPE_GUIDANCE } from './rules';
import { familyRecipe } from './plan';

/**
 * Page-by-page planning. One prompt per chapter instead of one prompt for the whole
 * carousel: each call is small enough for the local model's context, a bad page fails alone
 * and retries alone, and every page knows what the other pages cover. That context comes
 * from the book (titles and points of the other chapters), not from generated pages, so the
 * pages can be planned in parallel — a Claude call costs ~15 s of start-up each.
 */
export const PAGE_CONCURRENCY = 4;

export const SLIDE_SHAPE = `Return ONLY ONE Slide object for THIS chapter (not a whole post), no prose and no markdown fences:
{"page_title":string,"subtitle"?:string,"hero"?:IconName,"blocks":[Block,...]}
or, for a cover chapter:
{"kind":"cover","page_title":string,"hero"?:IconName,"blocks":[],"cover":{"title":string,"subtitle"?:string,"tagline"?:string,"icons"?:[{"icon":IconName,"label":string,"sub"?:string}],"pills"?:[string]}}
Ignore the post envelope and slide-count rules in the vocabulary below; the block vocabulary, inline markup, icons and per-block ceilings apply to this one page.
ONE PAGE ONLY: this chapter must fit one handwritten page. With an icon-card strip or a flowchart on the page, write 8-11 blocks; with text, tables and code only, 12-16. Never write more than a page; a second page is a separate chapter.`;

export type PriorPage = { index: number; title: string; taught: string[] };

export function chapterPrompt(opts: {
  brand: string;
  template: string;
  book: Book;
  index: number;
  prior: PriorPage[];
  coveredElsewhere?: string[];
}): string {
  const { book, index } = opts;
  const chapter = book.chapters[index];
  const hint = chapter.layout?.length
    ? `The reference page this chapter came from used these blocks in this order (a HINT about density and section order, not an order to copy): ${chapter.layout.map((l) => `${l.type} (${l.note})`).join(' → ')}. Keep its section order and density; choose the best block for each point.`
    : chapter.shape?.length
      ? `Shape this page from these section roles, in order: ${chapter.shape.join(' → ')}.`
      : 'Shape this page as dense study notes: definition, mechanism, example, mistakes, summary.';
  const prior = opts.prior.length
    ? `The other pages of this handbook (do not repeat what they cover; refer to them if useful):\n${opts.prior
        .map((p) => `${p.index + 1}. ${p.title}: ${p.taught.slice(0, 6).join('; ')}`)
        .join('\n')}`
    : 'This handbook has only this page.';
  return [
    `You are the content designer for "${opts.brand}", an Instagram account publishing tech handbooks as handwritten-notes carousels.`,
    `Handbook: "${book.title}" — ${book.summary}`,
    `You are writing page ${index + 1} of ${book.chapters.length}: "${chapter.title}".`,
    'EVERY point below must be taught on this page — nothing may be dropped:',
    JSON.stringify(chapter.points),
    hint,
    familyRecipe(opts.template),
    RECIPE_GUIDANCE,
    prior,
    opts.coveredElsewhere?.length ? `Other posts on this account already cover: ${opts.coveredElsewhere.join(', ')} — do not re-teach those, a one-line pointer is enough.` : '',
    'Write original prose — teach each point concretely with real examples, tables, diagrams and code, the way dense study notes do.',
    SLIDE_SHAPE,
    SCHEMA_RULES,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function captionPrompt(book: Book, brand: string): string {
  return [
    `Write the Instagram caption for a handwritten-notes carousel by "${brand}".`,
    `Handbook: "${book.title}" — ${book.summary}. Pages: ${book.chapters.map((c) => c.title).join('; ')}.`,
    'Return ONLY {"text": string, "hashtags": [string, ...]} — 2-3 sentences, hook first, then 8-12 relevant hashtags. No prose, no fences.',
  ].join('\n\n');
}

/** What every other chapter covers, straight from the book, so a page never repeats a neighbour. */
export function otherPages(book: Book, index: number): PriorPage[] {
  return book.chapters
    .map((c, i) => ({ index: i, title: c.title, taught: c.points }))
    .filter((p) => p.index !== index);
}

/** Runs `fn` over the indexes with at most `limit` in flight; results land in order. */
export async function mapLimit<T>(count: number, limit: number, fn: (i: number) => Promise<T>): Promise<T[]> {
  const out: T[] = new Array(count);
  let next = 0;
  const worker = async () => {
    while (next < count) {
      const i = next++;
      out[i] = await fn(i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, count) }, worker));
  return out;
}

async function askSlide(run: Runner, prompt: string): Promise<Slide> {
  const first = await run(prompt, { timeoutMs: 300_000 });
  try {
    return validateSlide(extractJson(first));
  } catch (err) {
    const retry = await run(
      `${prompt}\n\nYour previous output failed validation: ${String(err).slice(0, 500)}. Return the corrected Slide JSON only.`,
      { timeoutMs: 300_000 }
    );
    return validateSlide(extractJson(retry));
  }
}

async function askCaption(run: Runner, book: Book, brand: string): Promise<Post['caption']> {
  try {
    const out = extractJson(await run(captionPrompt(book, brand), { timeoutMs: 120_000 })) as { text?: unknown; hashtags?: unknown };
    const text = typeof out.text === 'string' ? out.text : book.summary;
    const hashtags = Array.isArray(out.hashtags) ? out.hashtags.filter((h): h is string => typeof h === 'string') : [];
    return { text, hashtags };
  } catch {
    return { text: book.summary, hashtags: [] };
  }
}

/**
 * Plans every chapter of the approved book as one page each, in order, then writes the post.
 * `run` is injectable so the sequence is testable without a model.
 */
export async function planPagesFromBook(
  subject: string,
  chapter: string,
  part: number,
  run: Runner = thinker(),
  onPage?: (index: number, slide: Slide) => void
): Promise<Post> {
  const book = await loadBook(subject, chapter);
  if (!book) throw new Error('no book yet — generate the book first');
  const s = getSettings();
  const existing = await loadPost(subject, chapter, part).catch(() => null);
  const template = existing?.template ?? s.defaultTemplate;

  let coveredElsewhere: string[] = [];
  try {
    const { coveredElsewhere: fn } = await import('../knowledge/spaces/handbooks');
    coveredElsewhere = await fn(subject, chapter);
  } catch { /* graph optional */ }

  const slides = await mapLimit(book.chapters.length, PAGE_CONCURRENCY, async (i) => {
    const slide = await askSlide(run, chapterPrompt({ brand: s.brand, template, book, index: i, prior: otherPages(book, i), coveredElsewhere }));
    onPage?.(i, slide);
    return slide;
  });

  const caption = await askCaption(run, book, s.brand);
  const post = validatePost({
    brand: s.brand,
    template,
    ratio: existing?.ratio ?? s.defaultRatio,
    seed: existing?.seed ?? 42,
    series: existing?.series ?? book.title.toUpperCase(),
    date: existing?.date ?? new Date().toLocaleDateString('en-GB'),
    slides,
    caption,
  });
  await savePost(subject, chapter, part, post);
  return post;
}
