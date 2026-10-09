import { promises as fs } from 'fs';
import path from 'path';
import { Post, Slide, validatePost, MAX_SLIDES } from '../schema';
import { SCHEMA_RULES, RECIPE_GUIDANCE } from './rules';
import { templateManifest } from '../renderer/page';
export { SCHEMA_RULES, RECIPE_GUIDANCE } from './rules';
import { getSettings } from '../settings';
import { savePost, loadPost, chapterCategory } from '../store';
import { refsDir } from '../paths';
import { thinker } from './runner';
import { extractJson } from './revise';
import { categoryOf } from '../handbookCategories';
import { Book, bookFromReferences, bookFromTopic, loadBook, datasetRules } from './book';

function envelope(brand: string, template: string, ratio: string) {
  return `Use "brand": "${brand}", "template": "${template}", "ratio": "${ratio}", "seed": 42, today's date ${new Date().toLocaleDateString('en-GB')}. Write an engaging caption (2-3 sentences, hook first) and 8-12 relevant hashtags.`;
}

async function generate(prompt: string, allowedTools?: string[]): Promise<Post> {
  const first = await thinker()(prompt, { timeoutMs: 900_000, allowedTools });
  try {
    return validatePost(extractJson(first));
  } catch (err) {
    const retry = await thinker()(
      `${prompt}\n\nYour previous output failed validation: ${String(err).slice(0, 500)}. Return corrected JSON only.`,
      { timeoutMs: 900_000, allowedTools }
    );
    return validatePost(extractJson(retry));
  }
}

export async function downloadReferences(subject: string, chapter: string, urls: string[]): Promise<string[]> {
  const dir = refsDir(subject, chapter);
  await fs.mkdir(dir, { recursive: true });
  const files: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    const r = await fetch(urls[i]);
    if (!r.ok) throw new Error(`reference ${i + 1} fetch failed: ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const file = path.join(dir, `ref-${String(i + 1).padStart(2, '0')}.jpg`);
    await fs.writeFile(file, buf);
    files.push(file);
  }
  return files;
}

/** Step 1 of the pipeline: build the book (syllabus) from references or a topic. */
export async function planBook(
  subject: string, chapter: string, mode: 'topic' | 'references', input: string | string[]
): Promise<Book> {
  if (mode === 'references') {
    const files = await downloadReferences(subject, chapter, input as string[]);
    return bookFromReferences(subject, chapter, files);
  }
  return bookFromTopic(subject, chapter, input as string);
}

/** The family's own page recipe, read from its manifest; empty when a template has none. */
export function familyRecipe(template: string): string {
  try {
    const r = templateManifest(template).recipe;
    return r ? `FAMILY "${template}": ${r}` : '';
  } catch {
    return '';
  }
}

/** Step 2: turn the approved book into slides — every point must be covered somewhere. */
export async function planSlidesFromBook(subject: string, chapter: string, part: number): Promise<Post> {
  const book = await loadBook(subject, chapter);
  if (!book) throw new Error('no book yet — generate the book first');
  const category = await chapterCategory(subject, chapter).catch(() => undefined);
  const s = getSettings();
  const existing = await loadPost(subject, chapter, part).catch(() => null);

  const totalPoints = book.chapters.reduce((n, c) => n + c.points.length, 0);
  const hasLayout = book.chapters.some((c) => c.layout?.length);

  // Knowledge-graph context: what other posts in this account already teach.
  let covered: string[] = [];
  try {
    const { coveredElsewhere } = await import('../knowledge/spaces/handbooks');
    covered = await coveredElsewhere(subject, chapter);
  } catch { /* graph optional */ }

  const prompt = [
    `You are the content designer for "${s.brand}", an Instagram account publishing tech handbooks as handwritten-notes carousels.`,
    'Here is the approved book (syllabus). EVERY point in it must be taught somewhere in the slides — nothing may be dropped:',
    JSON.stringify(book),
    hasLayout
      ? `Each chapter was read from one reference page and carries a "layout": the block sequence that page used, with a note per block. Treat it as a HINT about density and section order, not an order: write one slide per chapter, keep the reference's section order and its density, but choose the best block for each point — an "array" where the page drew cells, "cards" with icons where it drew a strip of concepts, "schema" or "tables" where it drew example tables, a titled icon "flowchart" where it drew a service diagram. Write original wording.`
      : `That is ${book.chapters.length} chapters and ${totalPoints} points. Each chapter carries a "shape": the section roles that page should have, in order (definition, mechanism, example, comparison, mistakes, summary, cheatsheet, cover). Give every chapter one slide built from its shape, at full page density; keep the book's order.`,
    datasetRules(book, category),
    familyRecipe(existing?.template ?? s.defaultTemplate),
    'Write original prose — teach each point concretely with real examples, tables and code, the way dense study notes do.',
    RECIPE_GUIDANCE,
    covered.length
      ? `Other posts on this account already cover these topics — do not rehash them at length; reference them briefly if needed and spend the space on this book's own material:\n${covered.join(', ')}`
      : '',
    SCHEMA_RULES,
    envelope(s.brand, existing?.template ?? s.defaultTemplate, existing?.ratio ?? s.defaultRatio),
  ].filter(Boolean).join('\n\n');

  const post = await generate(prompt);
  await savePost(subject, chapter, part, post);
  return post;
}

/** Ask the AI to grow under-filled slides using the book, without touching the ones that fit. */
export async function densifySlides(
  subject: string, chapter: string, part: number,
  underfilled: { slide: number; fillPct: number; gentle?: boolean }[]
): Promise<Post> {
  const post = await loadPost(subject, chapter, part);
  const book = await loadBook(subject, chapter);
  const dataset = book ? datasetRules(book, await chapterCategory(subject, chapter).catch(() => undefined)) : '';
  // Blocks are the currency the model can count, so the ask is in blocks, not in percent:
  // "grow toward 100%" makes it overshoot by a page, which spills and leaves a thinner tail.
  const list = underfilled
    .map((u) => {
      const have = post.slides[u.slide - 1]?.blocks.length ?? 0;
      const add = Math.max(1, Math.round((have * (100 - u.fillPct)) / Math.max(u.fillPct, 25)));
      // A gentle ask follows one that spilled: half as much, and only small blocks, so the
      // page fills toward its bottom edge instead of over it.
      if (u.gentle) {
        return `slide ${u.slide} (${u.fillPct}% full, ${have} blocks — the last attempt overflowed it; add at most ${Math.max(1, Math.floor(add / 2))} SMALL blocks: a table row, a one-line tip, a short bullet list)`;
      }
      return `slide ${u.slide} (${u.fillPct}% full, ${have} blocks — add about ${add} more)`;
    })
    .join(', ');
  const prompt = [
    'You are tightening a handwritten-notes carousel so every page looks fully used.',
    `These slides have wasted space: ${list}. Grow ONLY those slides to just fill the page — roughly the number of blocks named, no more, since overshooting spills onto a new near-empty page — by adding genuinely useful content — another numbered section, more table rows, an extra example, a tip callout. Do not pad with filler and do not touch the other slides.`,
    book ? `The book (syllabus) for this post — prefer adding points from it that are thin or missing:\n${JSON.stringify(book)}` : '',
    dataset,
    'Current post JSON:',
    JSON.stringify(post),
    SCHEMA_RULES,
  ].filter(Boolean).join('\n\n');

  return generate(prompt);
}

/** The words a page teaches with: lowercased, five letters or more, so wording can change. */
function teachingWords(blocks: unknown): Set<string> {
  return new Set((JSON.stringify(blocks).toLowerCase().match(/[a-z][a-z0-9_]{4,}/g) ?? [])
    .filter((w) => !['items', 'blocks', 'heading', 'bullets', 'lines', 'headers', 'style', 'frame', 'callout', 'title', 'paragraph'].includes(w)));
}

/** The "Q<n>. " items a page carries: question headings and qa questions. */
function questionItems(blocks: Slide['blocks']): number {
  return blocks.filter((b) => /^Q\d+\.\s/.test(b.type === 'heading' ? b.text : b.type === 'qa' ? b.q : '')).length;
}

/** How many blocks' worth of page a condensed page may use: what 92% of a page holds at the current density. */
export function blockBudget(blocks: number, neededPct: number): number {
  return Math.max(1, Math.floor((blocks * 92) / Math.max(neededPct, 1)));
}

/**
 * Pulls a thin page that a spill made back into the page it came from, condensed to fit one
 * page. Densifying such a page only grows it until it spills again; condensing removes it. It is
 * a rewrite, not a trim: the pair's teaching words must survive (and, with a book, every point
 * the post covered), or the proposal is rejected. `neededPct` is how much page the pair needs.
 *
 * "Fit one page at about 95%" was not a number a model can act on, and a condensed pair still
 * spilled. The ask is in blocks now (the currency the model can count), and the proposal is
 * measured: if it still needs more than a page it is asked once more with the measured number.
 * A second proposal that fails a guard is dropped and the first one, which passed them, stands.
 */
export async function pullBack(
  subject: string, chapter: string, part: number, contSlide: number, neededPct: number,
  measure?: (post: Post) => Promise<{ slide: number; neededPct: number }[]>
): Promise<Post> {
  const post = await loadPost(subject, chapter, part);
  const i = contSlide - 1;
  const parent = post.slides[i - 1];
  const cont = post.slides[i];
  if (!parent || !cont) throw new Error(`pull-back: no page ${contSlide} with a page before it`);
  const pair = { ...parent, blocks: [...parent.blocks, ...cont.blocks] };
  return condense(subject, chapter, post, i - 1, i, pair, neededPct, parent.cont,
    `You are fitting ONE page of a handwritten-notes carousel. It has ${pair.blocks.length} blocks and needs about ${neededPct}% of a page, so it spills onto a second, nearly empty page.`,
    measure);
}

/**
 * Condenses ONE page that overflows (taller than a page, so its foot is clipped) to fit, by the
 * same rules as pullBack: a block budget, a measurement, one re-ask, and the same guards (the
 * page's teaching words and every book point survive). `neededPct` is how much page it needs.
 */
export async function condenseSlide(
  subject: string, chapter: string, part: number, slideNo: number, neededPct: number,
  measure?: (post: Post) => Promise<{ slide: number; neededPct: number }[]>,
  why = 'so its foot is clipped'
): Promise<Post> {
  const post = await loadPost(subject, chapter, part);
  const i = slideNo - 1;
  const slide = post.slides[i];
  if (!slide) throw new Error(`condense: no page ${slideNo}`);
  return condense(subject, chapter, post, i, i, slide, neededPct, slide.cont,
    `You are fitting ONE page of a handwritten-notes carousel. It has ${slide.blocks.length} blocks and needs about ${neededPct}% of a page, ${why}.`,
    measure);
}

/**
 * Fits every authored page of a part to one page, right after planning. The model cannot know
 * how much page its content takes, and an over-long page is never clipped: auto-flow spills it
 * onto a "(cont.)" page that nothing wants. So each page that measures over 100% is condensed
 * while it is still one page, and a proposal is kept only when it measures lower than before
 * (saved page by page, so one failure costs one page). Covers are skipped. Item numbers are set
 * last, in page order. `measure` is injectable so the sequence is testable without a browser.
 */
export async function fitPlannedPages(
  subject: string, chapter: string, part: number,
  measure?: (post: Post) => Promise<{ slide: number; neededPct: number }[]>
): Promise<{ post: Post; condensed: number; failed: number }> {
  const run = measure ?? (await import('./fit')).measureSlides;
  let post = await loadPost(subject, chapter, part);
  // A page an earlier render split in two is one authored page again: it is the pair that is over-long.
  if (post.slides.some((s) => s.cont)) {
    const { mergeContinuations } = await import('../renderer/capture');
    post = { ...post, slides: mergeContinuations(post.slides) };
    await savePost(subject, chapter, part, post);
  }
  let condensed = 0;
  let failed = 0;
  for (const m of await run(post)) {
    const slide = post.slides[m.slide - 1];
    if (!slide || slide.kind === 'cover' || m.neededPct <= 100) continue;
    try {
      const proposal = await condenseSlide(subject, chapter, part, m.slide, m.neededPct, run, 'so it spills onto a second page');
      const [after] = await run({ ...proposal, slides: [proposal.slides[m.slide - 1]] });
      if (!after || after.neededPct >= m.neededPct) { failed++; continue; }
      await savePost(subject, chapter, part, proposal);
      post = proposal;
      condensed++;
    } catch {
      failed++; // a rejected proposal changes nothing
    }
  }
  const { applyNumbering } = await import('./numbering');
  return { post: await applyNumbering(subject, chapter, part), condensed, failed };
}

/** Replaces slides[from..to] of the post with one condensed page; the shared body of pullBack and condenseSlide. */
async function condense(
  subject: string, chapter: string, post: Post, from: number, to: number,
  pair: Slide, neededPct: number, cont: boolean | undefined, why: string,
  measure?: (post: Post) => Promise<{ slide: number; neededPct: number }[]>
): Promise<Post> {
  const { validateSlide } = await import('../schema');
  const ask = async (prompt: string) => {
    const slide = validateSlide(extractJson(await thinker()(prompt, { timeoutMs: 300_000 })));
    slide.cont = cont;
    return slide;
  };
  const book = await loadBook(subject, chapter);
  // A drills page, a listicle page and a Q&A page are templates: condensing must not rebuild them.
  const category = categoryOf(await chapterCategory(subject, chapter).catch(() => undefined));
  const templated = category.id !== 'handbook';
  const dataset = book ? datasetRules(book, category.id) : '';
  const rewrite = (current: unknown[], pct: number, reason: string) => [
    reason,
    `Rewrite it to fit one page at about 92%: the result must fit in about ${blockBudget(current.length, pct)} blocks' worth. `
      + (templated
        ? 'Cut repeated sentences, shrink table cells to 1-3 word cells, cut rows and bullets. '
        : 'Merge bullets, cut repeated sentences, shrink table cells to 1-3 word cells, join small sections. ')
      + 'Keep EVERY fact, example, table row and code line: condense, never omit.',
    ...(templated ? [
      `This page belongs to a "${category.name}" carousel. Its page rules: ${category.presentation.pageRules}`,
      "Keep this page's template: the same block types in the same order; shorten text inside blocks, cut rows and bullets, "
        + "but never merge, drop or retype a heading, a qa block, a concept or a labelrows block. Every 'Q<n>.' item stays its own heading or qa block.",
    ] : []),
    'Return ONLY the one Slide object, no prose and no markdown fences.',
  ];
  const prompt = [
    ...rewrite(pair.blocks, neededPct, why),
    dataset,
    'The page:',
    JSON.stringify(pair),
    SCHEMA_RULES,
  ].filter(Boolean).join('\n\n');

  const lostBefore = book ? new Set((await import('./fit')).uncoveredPoints(book, post)) : new Set<string>();
  const before = teachingWords(pair.blocks);
  // The guards: the page's words survive, and (with a book) no point the post covered is lost.
  const itemsBefore = questionItems(pair.blocks);
  const check = async (slide: Slide): Promise<Post> => {
    // Structure first: a page that lost its numbered items or its template blocks is a different page.
    const items = questionItems(slide.blocks);
    if (items < itemsBefore) throw new Error(`condense merged numbered items (${itemsBefore} Q<n>. items became ${items}) - rejected`);
    for (const type of ['concept', 'labelrows'] as const) {
      if (pair.blocks.some((b) => b.type === type) && !slide.blocks.some((b) => b.type === type)) {
        throw new Error(`condense dropped the ${type} block - rejected`);
      }
    }
    const after = teachingWords(slide.blocks);
    const kept = [...before].filter((w) => after.has(w)).length / Math.max(1, before.size);
    if (kept < 0.8) throw new Error(`pull-back dropped material (${Math.round((1 - kept) * 100)}% of its words) - rejected`);
    const proposal = { ...post, slides: [...post.slides.slice(0, from), slide, ...post.slides.slice(to + 1)] };
    if (book) {
      const { uncoveredPoints } = await import('./fit');
      const dropped = uncoveredPoints(book, proposal).filter((p) => !lostBefore.has(p));
      if (dropped.length) throw new Error(`pull-back dropped ${dropped.length} book point(s) - rejected`);
    }
    return validatePost(proposal);
  };

  const first = await ask(prompt);
  const accepted = await check(first);

  // Measure the one slide as the renderer will draw it. Over a page it spills again.
  const run = measure ?? (await import('./fit')).measureSlides;
  const [m] = await run({ ...post, slides: [first] });
  if (!m || m.neededPct <= 100) return accepted;
  try {
    const second = await ask([
      ...rewrite(first.blocks, m.neededPct,
        `Your rewrite was rendered and still needs ${m.neededPct}% of a page, so it would not fit. It has ${first.blocks.length} blocks.`),
      dataset,
      'Your rewrite:',
      JSON.stringify(first),
      SCHEMA_RULES,
    ].filter(Boolean).join('\n\n'));
    return await check(second);
  } catch {
    return accepted;
  }
}
