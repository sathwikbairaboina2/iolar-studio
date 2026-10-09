import { Post, Slide, validatePost, validateSlide } from '../schema';
import { getSettings } from '../settings';
import { loadPost, savePost, loadChapterMeta } from '../store';
import { provider, thinker, Runner } from './runner';
import { extractJson } from './revise';
import { Book, loadBook, datasetRules } from './book';
import { SCHEMA_RULES, RECIPE_GUIDANCE } from './rules';
import { familyRecipe } from './plan';
import { categoryOf, itemRange, isCover, isItemChapter } from '../handbookCategories';

/**
 * The chapter's category, cut into the page prompt: its page template and item rules, and for
 * items numbered across pages, the numbers this page carries. Empty when no category is given.
 */
export function categoryPageRules(book: Book, index: number, category?: string): string {
  if (!category) return '';
  const c = categoryOf(category);
  const chapter = book.chapters[index];
  // The template is for item pages. A cover gets the cover recipe; an intro or closing page
  // (a shape sharing under half the template's roles) keeps the shape the book gave it.
  if (isCover(chapter)) return `CATEGORY "${c.name}": this page is the cover. ${c.presentation.cover}`;
  if (!isItemChapter(category, chapter, book.chapters)) {
    const closing = index === book.chapters.length - 1 ? ` If this page closes the post: ${c.presentation.closing}` : '';
    return `CATEGORY "${c.name}": this is an intro or closing page, not an item page. Follow its own shape, not the item template. Rules: ${c.content.rules.join(' ')}${closing}`;
  }
  const lines = [
    `CATEGORY "${c.name}": this page is ${c.content.unit} (${c.presentation.itemsPerPage}). ${c.presentation.pageRules}`,
    `Rules: ${c.content.rules.join(' ')}`,
  ];
  if (c.presentation.numbering === 'continuous') {
    const { from, to } = itemRange(book, index);
    lines.push(`This page carries items Q${from} to Q${to}, numbered exactly so, in the order of the points.`);
  }
  if (index === book.chapters.length - 1) lines.push(`If this page closes the post: ${c.presentation.closing}`);
  return lines.join('\n');
}

/**
 * The template a part is planned in. A part that still has the template new chapters used to be
 * seeded with (the settings default) takes the category's family; anything else was chosen by
 * the user and stays. With no category there is nothing to move to.
 */
export function templateFor(existing: string | undefined, seededDefault: string, category?: string): string {
  if (!category) return existing ?? seededDefault;
  if (!existing || existing === seededDefault) return categoryOf(category).presentation.template;
  return existing;
}

/** Title words that are never the topic: counts, hype and the category's own nouns. */
const FILLER = new Set(('the a an of to in for and with you your every all most asked top best complete ultimate essential '
  + 'must know should can t skip developer developers interview interviews question questions answers concept concepts '
  + 'handbook guide notes system design practice queries query drills edition').split(' '));

/** The comment-gate keyword: the first topic word of the title ("50 Most Asked API Questions" → "api"). */
export function ctaKeyword(title: string): string {
  return title.toLowerCase().split(/[^a-z0-9.#+]+/).find((w) => w && !/^\d+$/.test(w) && !FILLER.has(w)) ?? 'pdf';
}

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

/**
 * Brand marks are for pages about that brand. Planners reach for the database or container logo
 * on every page of a database or container post; a concept page about indexing is not a
 * PostgreSQL page, and the cover strip is not a row of vendor logos.
 */
export const ICON_RULE = 'ICON CHOICE (hero, cover icons, flowchart and card icons): use a brand or product logo (postgresql, mysql, docker, kafka, redis, mongodb and the like) only when this page is about that product. A generic concept page (indexing, transactions, caching, REST, joins) takes a generic icon (database, server, lock, zap, network, table, shield-check, lightbulb) or no hero at all.';

export type PriorPage = { index: number; title: string; taught: string[] };

export function chapterPrompt(opts: {
  brand: string;
  template: string;
  book: Book;
  index: number;
  prior: PriorPage[];
  coveredElsewhere?: string[];
  category?: string;
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
    categoryPageRules(book, index, opts.category),
    datasetRules(book, opts.category),
    familyRecipe(opts.template),
    RECIPE_GUIDANCE,
    ICON_RULE,
    prior,
    opts.coveredElsewhere?.length ? `Other posts on this account already cover: ${opts.coveredElsewhere.join(', ')} — do not re-teach those, a one-line pointer is enough.` : '',
    'Write original prose — teach each point concretely with real examples, tables, diagrams and code, the way dense study notes do.',
    SLIDE_SHAPE,
    SCHEMA_RULES,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function captionPrompt(book: Book, brand: string, category?: string): string {
  const c = category ? categoryOf(category) : null;
  return [
    `Write the Instagram caption for a handwritten-notes carousel by "${brand}".`,
    `Handbook: "${book.title}" — ${book.summary}. Pages: ${book.chapters.map((c) => c.title).join('; ')}.`,
    c ? `CATEGORY "${c.name}": ${c.script.caption}` : '',
    c ? `End the caption with this call to action, verbatim: ${c.script.cta.replace('{keyword}', ctaKeyword(book.title))}` : '',
    c
      ? 'Return ONLY {"text": string, "hashtags": [string, ...]} with 8-12 relevant hashtags. No prose, no fences.'
      : 'Return ONLY {"text": string, "hashtags": [string, ...]} — 2-3 sentences, hook first, then 8-12 relevant hashtags. No prose, no fences.',
  ].filter(Boolean).join('\n\n');
}

/**
 * The ribbon name for the carousel. Creating a chapter seeds part 1 with the chapter title
 * as its series, so that placeholder must lose to the book's own title; anything the user
 * typed themselves wins. Long book titles carry a colon subtitle the ribbon has no room for.
 */
export function seriesFor(existing: string | undefined, placeholder: string | undefined, bookTitle: string): string {
  if (existing && existing.toUpperCase() !== (placeholder ?? '').toUpperCase()) return existing;
  return bookTitle.split(/[:—–|]/)[0].trim().toUpperCase();
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

/**
 * The local model tends to follow the post-shaped SCHEMA_RULES over SLIDE_SHAPE and wraps its
 * one page in a whole post envelope. A single wrapped slide is still one page, so take it; an
 * envelope of several slides is a page that overflowed and must fail validation. Local only:
 * on Claude an envelope stays a validation failure, as it always was.
 */
function slideOf(json: unknown): unknown {
  if (provider() !== 'local') return json;
  const slides = (json as { slides?: unknown })?.slides;
  return Array.isArray(slides) && slides.length === 1 ? slides[0] : json;
}

async function askSlide(run: Runner, prompt: string): Promise<Slide> {
  const first = await run(prompt, { timeoutMs: 300_000 });
  try {
    return validateSlide(slideOf(extractJson(first)));
  } catch (err) {
    const retry = await run(
      `${prompt}\n\nYour previous output failed validation: ${String(err).slice(0, 500)}. Return the corrected Slide JSON only.`,
      { timeoutMs: 300_000 }
    );
    return validateSlide(slideOf(extractJson(retry)));
  }
}

async function askCaption(run: Runner, book: Book, brand: string, category?: string): Promise<Post['caption']> {
  try {
    const out = extractJson(await run(captionPrompt(book, brand, category), { timeoutMs: 120_000 })) as { text?: unknown; hashtags?: unknown };
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
  const { chapterCategory } = await import('../store');
  const category = await chapterCategory(subject, chapter).catch(() => undefined);
  const template = templateFor(existing?.template, s.defaultTemplate, category);

  let coveredElsewhere: string[] = [];
  try {
    const { coveredElsewhere: fn } = await import('../knowledge/spaces/handbooks');
    coveredElsewhere = await fn(subject, chapter);
  } catch { /* graph optional */ }

  const slides = await mapLimit(book.chapters.length, PAGE_CONCURRENCY, async (i) => {
    const slide = await askSlide(run, chapterPrompt({ brand: s.brand, template, book, index: i, prior: otherPages(book, i), coveredElsewhere, category }));
    onPage?.(i, slide);
    return slide;
  });

  const caption = await askCaption(run, book, s.brand, category);
  const post = validatePost({
    brand: s.brand,
    template,
    ratio: existing?.ratio ?? s.defaultRatio,
    seed: existing?.seed ?? 42,
    series: seriesFor(existing?.series, (await loadChapterMeta(subject, chapter).catch(() => null))?.title, book.title),
    date: existing?.date ?? new Date().toLocaleDateString('en-GB'),
    slides,
    caption,
  });
  await savePost(subject, chapter, part, post);
  return post;
}
