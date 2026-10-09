import { promises as fs } from 'fs';
import path from 'path';
import { chromium, Browser } from 'playwright';
import sharp from 'sharp';
import { Post, RATIOS } from '../schema';
import { buildSlideHtml, templateManifest, templatesRoot } from './page';
import { collectWarnings } from './blocks';

let browserPromise: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: ['--force-color-profile=srgb', '--disable-lcd-text', '--hide-scrollbars', '--font-render-hinting=none'],
    });
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (browserPromise) {
    const b = await browserPromise;
    browserPromise = null;
    await b.close();
  }
}

declare global {
  interface Window {
    LAYOUT: { spillIndexes: number[]; usedPx: number; usablePx: number; neededPct: number };
  }
}

export type RenderResult = { overflowPx: number; fillPct: number; spillIndexes: number[]; neededPct: number; warnings: string[] };

export async function renderSlide(post: Post, slideIndex: number, outPath: string, opts: { pageCount?: number } = {}): Promise<RenderResult> {
  const [w, h] = RATIOS[post.ratio];
  const html = buildSlideHtml(post, slideIndex, opts);
  const manifest = templateManifest(post.template);

  // Temp file inside the template dir so ../_shared relative paths resolve.
  const tmpFile = path.join(
    templatesRoot(),
    post.template,
    `.render-${process.pid}-${Date.now()}-${slideIndex}.html`
  );
  await fs.writeFile(tmpFile, html);

  try {
    const browser = await getBrowser();
    const page = await browser.newPage({
      viewport: { width: w * 2, height: h * 2 },
      deviceScaleFactor: 1,
    });
    try {
      await page.goto('file://' + tmpFile.replace(/\\/g, '/'));
      await page.waitForSelector('body[data-layout-done="1"]', { timeout: 20000 });
      await page.waitForSelector('body[data-jitter-done="1"]', { timeout: 20000 });
      await page.evaluate(() => document.fonts.ready);

      const layout = await page.evaluate(() => window.LAYOUT);
      const overflowPx = Math.max(0, layout.usedPx - layout.usablePx);
      const fillPct = Math.round((layout.usedPx / layout.usablePx) * 100);

      const shot = await page.screenshot({ type: 'png' });
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await sharp(shot).resize(w, h, { kernel: 'lanczos3' }).png().toFile(outPath);

      const warnings = collectWarnings(post.slides[slideIndex].blocks, post.slides[slideIndex]);
      return { overflowPx, fillPct, spillIndexes: layout.spillIndexes, neededPct: layout.neededPct, warnings };
    } finally {
      await page.close();
    }
  } finally {
    await fs.unlink(tmpFile).catch(() => {});
  }
}

const MAX_AUTOFLOW_PAGES = 40; // guard against a single unsplittable block looping forever

/**
 * Collapses continuation pages back into the page they spilled from, so a re-render
 * re-splits from the authored content instead of splitting an already-split page.
 */
export function mergeContinuations(input: Post['slides']): Post['slides'] {
  const slides: Post['slides'] = [];
  for (const s of input) {
    const prev = slides[slides.length - 1];
    if (prev && s.cont && prev.kind !== 'cover') {
      prev.blocks.push(...s.blocks);
      continue;
    }
    slides.push({ ...s, blocks: [...s.blocks] });
  }
  return slides;
}

/** One authored block queued for flow, tagged with the authored slide it came from. */
export type FlowItem = { block: Post['slides'][number]['blocks'][number]; from: number };

/**
 * The leading stretch of the queue that all came from ONE authored slide.
 *
 * A page is filled from this rather than from the whole queue, so it never mixes two
 * chapters. Letting the stream run across a chapter boundary is what put a chapter's
 * opening code blocks at the foot of the previous chapter's page and left dangling tails
 * at the top of the next one — 96 review findings traced to that single rule.
 *
 * The cost is deliberate: a short chapter now yields a short page instead of borrowing the
 * next chapter's material. Filling it is the densify pass's job, which adds from the book.
 */
export function leadingRun(queue: FlowItem[]): FlowItem[] {
  if (!queue.length) return [];
  const from = queue[0].from;
  let end = 0;
  while (end < queue.length && queue[end].from === from) end++;
  return queue.slice(0, end);
}

/**
 * A continuation page that would hold only "Key takeaways" callouts. The takeaway repeats the
 * page it closes, and the model cannot know how much room is left, so it is the block that falls
 * off the foot; a page of nothing but it is the worst outcome, so it is dropped instead.
 */
export function isStrandedTakeaway(run: FlowItem[]): boolean {
  return run.length > 0 && run.every(({ block }) => block.type === 'callout' && /takeaway/i.test(block.title));
}

/**
 * Fits an overflowing page that holds code by cutting it: whole blocks first, then the first
 * block that no longer fits is cut along its lines (code only) until the page is full.
 *
 * Consecutive code blocks are one unit to the packer, so a stack of them is "one block" taller
 * than the page and renders clipped (sql-drills page 16 at 135%). Growing the page block by block
 * keeps it as full as the flow would have made it had the stack been splittable. Only the end of
 * the code carries its note and result, so a cut drops both from the first part. Blocks after
 * the cut move on with it, so the authored order holds. Returns null when nothing can be cut
 * (no code on the page, or even one line does not fit): the page keeps its overflow and the
 * polish step condenses it instead.
 */
async function splitCodeToFit(
  post: Post,
  slides: Post['slides'],
  page: Post['slides'][number],
  pageIndex: number,
  file: string,
  first: RenderResult
): Promise<{ page: Post['slides'][number]; rest: Post['slides'][number]['blocks']; result: RenderResult } | null> {
  if (!page.blocks.some((b) => b.type === 'code' && b.lines.length > 1)) return null;
  const draw = (blocks: Post['slides'][number]['blocks']) => renderSlide({ ...post, slides: [...slides, { ...page, blocks }] }, pageIndex, file);
  const prefix: Post['slides'][number]['blocks'] = [];
  let result: RenderResult | null = null;
  let rest: Post['slides'][number]['blocks'] = page.blocks;

  for (let j = 0; j < page.blocks.length; j++) {
    const block = page.blocks[j];
    const whole = j === 0 && page.blocks.length === 1 ? first : await draw([...prefix, block]);
    if (whole.overflowPx === 0) { prefix.push(block); result = whole; rest = page.blocks.slice(j + 1); continue; }
    if (block.type === 'code' && block.lines.length > 1) {
      let keep = block.lines.length;
      let tried = whole;
      for (let attempt = 0; attempt < 10 && tried.overflowPx > 0 && keep > 1; attempt++) {
        // fillPct is used/usable, so the share that overflows is 1 - 100/fillPct; round up, a line of margin after the first try.
        keep = Math.max(1, keep - Math.max(1, Math.ceil(keep * (1 - 100 / Math.max(tried.fillPct, 101))) + (attempt ? 1 : 0)));
        tried = await draw([...prefix, { type: 'code', lang: block.lang, lines: block.lines.slice(0, keep) }]);
      }
      if (tried.overflowPx === 0) {
        prefix.push({ type: 'code', lang: block.lang, lines: block.lines.slice(0, keep) });
        result = tried;
        rest = [{ ...block, lines: block.lines.slice(keep) }, ...page.blocks.slice(j + 1)];
      }
    }
    break;
  }
  if (!result) return null;
  // A heading is bound to the block after it; left last on a page it is drawn alone.
  while (prefix.length > 1 && prefix[prefix.length - 1].type === 'heading') rest = [prefix.pop()!, ...rest], result = null;
  // The file on disk is the last thing drawn, which is not always the page that was kept.
  result = await draw(prefix);
  return result.overflowPx > 0 ? null : { page: { ...page, blocks: prefix }, rest, result };
}

export async function renderAll(
  post: Post,
  outDir: string
): Promise<{
  results: { slide: number; overflowPx: number; fillPct: number; file: string; warnings: string[] }[];
  slides: Post['slides'];
}> {
  const authored = mergeContinuations(post.slides);

  // Blocks flow within a chapter but never across one: a page is filled from the leading
  // run of blocks sharing an authored slide, so a chapter that ends halfway down a page
  // leaves the rest of that page empty rather than pulling the next chapter up into it.
  // Nothing is trimmed. A page left thin this way is the densify pass's problem, and it
  // fills it from the book instead of from the chapter next door. A cover slide is its own
  // page, and the stream drains before it and restarts after it.
  type Item = FlowItem;
  const results: { slide: number; overflowPx: number; fillPct: number; file: string; warnings: string[] }[] = [];
  const slides: Post['slides'] = [];
  // Which authored slide each flowed page came from, index-aligned with `slides`/`results`.
  // A cover is nobody's chapter, so it gets -1 and never pairs with anything in balanceTail.
  const owners: number[] = [];
  const started = new Set<number>();
  let page = 0;

  const renderCoverPage = async (cover: Post['slides'][number]) => {
    const file = path.join(outDir, `slide-${String(page + 1).padStart(2, '0')}.png`);
    const working: Post = { ...post, slides: [...slides, cover] };
    const r = await renderSlide(working, page, file);
    slides.push(cover);
    owners.push(-1);
    results.push({ slide: page + 1, overflowPx: r.overflowPx, fillPct: r.fillPct, file, warnings: r.warnings });
    page++;
  };

  const segments: { cover?: Post['slides'][number]; queue: Item[] }[] = [];
  authored.forEach((s, i) => {
    if (s.kind === 'cover') { segments.push({ cover: s, queue: [] }); return; }
    if (!segments.length || segments[segments.length - 1].cover) segments.push({ queue: [] });
    segments[segments.length - 1].queue.push(...s.blocks.map((block) => ({ block, from: i })));
  });

  for (const seg of segments) {
  if (seg.cover) { await renderCoverPage(seg.cover); continue; }
  let queue = seg.queue;
  for (; queue.length && page < MAX_AUTOFLOW_PAGES; page++) {
    // Only this chapter's leading run is a candidate for the page. Whatever follows it
    // belongs to the next chapter and waits for a page of its own.
    const run = leadingRun(queue);
    const source = run[0].from;
    const base = authored[source].page_title.replace(/ \(cont\.\)$/, '');
    const isCont = started.has(source);
    if (isCont && isStrandedTakeaway(run)) {
      queue = queue.slice(run.length);
      results[results.length - 1].warnings.push('dropped stranded takeaway');
      page--; // no page was drawn; the loop's own step puts it back
      continue;
    }

    const src = authored[source];
    const candidate: Post['slides'][number] = {
      page_title: isCont ? `${base} (cont.)` : base,
      blocks: run.map((q) => q.block),
      // Only a page continuing the SAME chapter is a continuation. Marking every page
      // after the first would make mergeContinuations collapse the whole post into one.
      ...(isCont ? { cont: true } : {}),
      // The chapter's hero logo and subtitle belong to every page cut from it.
      ...(src.hero ? { hero: src.hero } : {}),
      ...(src.subtitle ? { subtitle: src.subtitle } : {}),
      // The corner note belongs to the chapter's first page only.
      ...(src.aside && !isCont ? { aside: src.aside } : {}),
    };

    const file = path.join(outDir, `slide-${String(page + 1).padStart(2, '0')}.png`);
    const working: Post = { ...post, slides: [...slides, candidate] };
    const r = await renderSlide(working, page, file);

    const spilled = new Set(r.spillIndexes);
    // Everything spilled: one block is taller than a page. Keep it alone rather than loop.
    const keepCount = spilled.size >= run.length ? 1 : run.length - spilled.size;
    const kept = run.filter((_, j) => !spilled.has(j)).slice(0, Math.max(keepCount, 1));
    const keptSet = new Set(kept.map((k) => k.block));

    // Every kept block came from `source` — the run guarantees it — so the page's owner is
    // known before it is measured. The old majority-owner tally and its re-measure under a
    // corrected title existed only because a page could straddle two chapters; it cannot now.
    let finished = { ...candidate, blocks: kept.map((k) => k.block) };
    let result = r;
    // A unit taller than a page is placed alone and overflows, clipped at the foot. A code block
    // can be cut along its lines: fit as many as the page holds and send the rest on.
    if (r.overflowPx > 0) {
      const cut = await splitCodeToFit(post, slides, finished, page, file, r);
      if (cut) {
        finished = cut.page;
        result = cut.result;
        queue = [...cut.rest.map((block) => ({ block, from: source })), ...queue.filter((q) => !keptSet.has(q.block))];
        keptSet.clear();
      }
    }
    started.add(source);
    owners.push(source);

    slides.push(finished);
    results.push({ slide: page + 1, overflowPx: result.overflowPx, fillPct: result.fillPct, file, warnings: result.warnings });
    queue = queue.filter((q) => !keptSet.has(q.block));
  }
  }

  // Walk the deficit back through the part: filling the tail from the page before it can
  // starve that page in turn, so the pair before that is balanced next, up to three pairs.
  for (let pair = 0; pair < TAIL_CASCADE; pair++) {
    const at = slides.length - 1 - pair;
    if (at < 1 || results[at].fillPct >= TAIL_FLOOR) break;
    if (!(await balanceTail(post, outDir, slides, results, at, owners))) break;
  }

  // While the flow runs, a page only knows how many pages exist so far. A family that prints
  // "of N" in its chrome gets every page drawn again once N is final; the layout is identical,
  // so fills and spills stay as measured.
  if (templateManifest(post.template).pageCountInChrome && slides.length > 1) {
    for (let i = 0; i < slides.length; i++) await renderSlide({ ...post, slides }, i, results[i].file);
  }

  return { results, slides };
}

/** A last page this thin is a scrap of a page, whatever the pages before it look like. */
export const TAIL_FLOOR = 80;

/** How many blocks may be pushed back from the page before the tail while looking for a split. */
const TAIL_SEARCH = 8;

/** How far back the rebalance walks: filling the tail can starve the page that fed it. */
const TAIL_CASCADE = 3;

/** A split has to earn the shuffle — a point or two of noise is not worth moving content. */
const TAIL_GAIN = 2;

/**
 * Evens out a starved last page by pushing blocks back into it from the page before.
 *
 * The flow fills each page greedily, so whatever is left over lands on the last one — a part
 * can end at 28% while every page before it sits at 97%. Densifying cannot fix that: the
 * model adds content, the flow re-fills the earlier pages first, and the tail keeps the
 * remainder. Moving the split back is what actually fills it.
 *
 * Every candidate split is measured, never estimated, and a split is only taken when it lifts
 * the worse of the two pages without overflowing either.
 */
export async function balanceTail(
  post: Post,
  outDir: string,
  slides: Post['slides'],
  results: { slide: number; overflowPx: number; fillPct: number; file: string; warnings: string[] }[],
  at = slides.length - 1,
  /** Authored-slide owner per page, index-aligned with `slides`. Omitted: no pairing guard. */
  owners?: number[]
): Promise<boolean> {
  const last = at;
  if (last < 1 || last >= slides.length) return false;
  if (results[last].fillPct >= TAIL_FLOOR) return false;
  if (slides[last].kind === 'cover' || slides[last - 1].kind === 'cover') return false;
  // Rebalancing re-cuts the two pages as one block list, which would put a chapter's blocks
  // on its neighbour's page — the very mixing the flow now refuses to do. Two pages may only
  // trade blocks when they are the same chapter.
  if (owners && (owners[last] === -1 || owners[last] !== owners[last - 1])) return false;

  const prev = slides[last - 1];
  const tail = slides[last];
  const combined = [...prev.blocks, ...tail.blocks];
  let bestCut = prev.blocks.length;
  let bestScore = Math.min(results[last - 1].fillPct, results[last].fillPct);
  let bestPair: [RenderResult, RenderResult] | null = null;

  const probe = path.join(outDir, '.tail-probe.png');
  for (let move = 1; move <= Math.min(TAIL_SEARCH, prev.blocks.length - 1); move++) {
    const cut = prev.blocks.length - move;
    // Never cut between a heading and its section: the layout binds a heading to the block
    // after it, but only on one page, so a heading left last on a page is drawn alone.
    if (combined[cut - 1].type === 'heading') continue;
    const a = { ...prev, blocks: combined.slice(0, cut) };
    const b = { ...tail, blocks: combined.slice(cut) };
    const working: Post = { ...post, slides: [...slides.slice(0, last - 1), a, b] };
    const ra = await renderSlide(working, last - 1, probe);
    if (ra.overflowPx > 0 || ra.spillIndexes.length) continue;
    const rb = await renderSlide(working, last, probe);
    if (rb.overflowPx > 0 || rb.spillIndexes.length) continue;
    const score = Math.min(ra.fillPct, rb.fillPct);
    if (score >= bestScore + TAIL_GAIN) {
      bestScore = score;
      bestCut = cut;
      bestPair = [ra, rb];
    }
  }
  await fs.rm(probe, { force: true });
  if (!bestPair) return false;

  slides[last - 1] = { ...prev, blocks: combined.slice(0, bestCut) };
  slides[last] = { ...tail, blocks: combined.slice(bestCut) };
  for (const [offset, r] of [[last - 1, bestPair[0]], [last, bestPair[1]]] as const) {
    const file = results[offset].file;
    await renderSlide({ ...post, slides }, offset, file);
    results[offset] = { ...results[offset], overflowPx: r.overflowPx, fillPct: r.fillPct, warnings: r.warnings };
  }
  return true;
}
