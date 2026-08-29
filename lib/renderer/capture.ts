import { promises as fs } from 'fs';
import path from 'path';
import { chromium, Browser } from 'playwright';
import sharp from 'sharp';
import { Post, RATIOS } from '../schema';
import { buildSlideHtml, templateManifest, templatesRoot } from './page';

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

export type RenderResult = { overflowPx: number; fillPct: number; spillIndexes: number[]; neededPct: number };

export async function renderSlide(post: Post, slideIndex: number, outPath: string): Promise<RenderResult> {
  const [w, h] = RATIOS[post.ratio];
  const html = buildSlideHtml(post, slideIndex);
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

      return { overflowPx, fillPct, spillIndexes: layout.spillIndexes, neededPct: layout.neededPct };
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
    if (prev && s.cont) {
      prev.blocks.push(...s.blocks);
      continue;
    }
    slides.push({ ...s, blocks: [...s.blocks] });
  }
  return slides;
}

export async function renderAll(
  post: Post,
  outDir: string
): Promise<{
  results: { slide: number; overflowPx: number; fillPct: number; file: string }[];
  slides: Post['slides'];
}> {
  const authored = mergeContinuations(post.slides);

  // Blocks flow as one stream across chapter boundaries: a chapter that ends halfway down
  // a page is followed by the next chapter on the same page. Nothing is trimmed, and no
  // page is left half empty just because a chapter ended there.
  type Item = { block: Post['slides'][number]['blocks'][number]; from: number };
  let queue: Item[] = authored.flatMap((s, i) => s.blocks.map((block) => ({ block, from: i })));

  const results: { slide: number; overflowPx: number; fillPct: number; file: string }[] = [];
  const slides: Post['slides'] = [];
  const started = new Set<number>();

  for (let page = 0; queue.length && page < MAX_AUTOFLOW_PAGES; page++) {
    const source = queue[0].from;
    const base = authored[source].page_title.replace(/ \(cont\.\)$/, '');
    const isCont = started.has(source);

    const candidate: Post['slides'][number] = {
      page_title: isCont ? `${base} (cont.)` : base,
      blocks: queue.map((q) => q.block),
      // Only a page continuing the SAME chapter is a continuation. Marking every page
      // after the first would make mergeContinuations collapse the whole post into one.
      ...(isCont ? { cont: true } : {}),
    };

    const file = path.join(outDir, `slide-${String(page + 1).padStart(2, '0')}.png`);
    const working: Post = { ...post, slides: [...slides, candidate] };
    const r = await renderSlide(working, page, file);

    const spilled = new Set(r.spillIndexes);
    // Everything spilled: one block is taller than a page. Keep it alone rather than loop.
    const keepCount = spilled.size >= queue.length ? 1 : queue.length - spilled.size;
    const kept = queue.filter((_, j) => !spilled.has(j)).slice(0, Math.max(keepCount, 1));
    const keptSet = new Set(kept.map((k) => k.block));

    // Content flows across chapter boundaries, so no mechanical rule titles a page well:
    // naming it after the first block describes the previous chapter's tail, and naming it
    // after the chapter with the most blocks shifts titles backwards whenever that tail is
    // long. The first block wins here because it is stable; the AI heading pass is what
    // makes titles describe the page, and it runs after a split.
    started.add(source);
    slides.push({ ...candidate, blocks: kept.map((k) => k.block) });
    results.push({ slide: page + 1, overflowPx: r.overflowPx, fillPct: r.fillPct, file });
    queue = queue.filter((q) => !keptSet.has(q.block));
  }

  await balanceTail(post, slides, results, outDir);
  return { results, slides };
}

/**
 * Pagination leaves whatever is left over on the final page, so a part can end on a page
 * that is 15% full. Nothing is added or removed to fix that — blocks move back from the
 * previous page until the two share the load. Earlier pages are untouched, because making
 * every page equal is what left them all half empty before.
 */
async function balanceTail(
  post: Post,
  slides: Post['slides'],
  results: { slide: number; overflowPx: number; fillPct: number; file: string }[],
  outDir: string
) {
  const THIN = 55; // a final page below this reads as an accident
  const TARGET = 70; // once the tail reaches this it no longer looks like a mistake
  const FLOOR = 62; // never starve the page we borrow from

  for (let move = 0; move < 10; move++) {
    if (slides.length < 2) return;
    const lastIndex = slides.length - 1;
    const last = results[lastIndex];
    const prev = results[lastIndex - 1];
    if (!last || !prev) return;
    if (last.fillPct >= (move === 0 ? THIN : TARGET)) return;
    if (slides[lastIndex - 1].blocks.length < 2) return;

    const trial = slides.map((s) => ({ ...s, blocks: [...s.blocks] }));
    const moved = trial[lastIndex - 1].blocks.pop()!;
    trial[lastIndex].blocks.unshift(moved);

    const working: Post = { ...post, slides: trial };
    const prevResult = await renderSlide(working, lastIndex - 1, prev.file);
    const lastResult = await renderSlide(working, lastIndex, last.file);

    // A single block is often a heading worth ~1% of a page, so one move can leave the
    // rounded fill unchanged. Keep moving while it stays safe rather than giving up on the
    // first move that does not visibly help.
    const safe =
      prevResult.fillPct >= FLOOR &&
      prevResult.overflowPx === 0 &&
      lastResult.overflowPx === 0 &&
      lastResult.spillIndexes.length === 0;

    if (process.env.INSTASTUDIO_DEBUG_TAIL) {
      console.log('[tail]', JSON.stringify({
        move, lastWas: last.fillPct, lastNow: lastResult.fillPct,
        prevWas: prev.fillPct, prevNow: prevResult.fillPct,
        lastSpill: lastResult.spillIndexes.length, lastOverflow: lastResult.overflowPx,
        prevOverflow: prevResult.overflowPx, safe,
      }));
    }
    if (!safe) {
      // Put the pages back as they were. This must re-render the PAGINATED slides, not
      // post.slides — pagination can produce more pages than there are authored chapters,
      // so indexing the original post here reads past its end.
      const restore: Post = { ...post, slides };
      await renderSlide(restore, lastIndex - 1, prev.file);
      await renderSlide(restore, lastIndex, last.file);
      return;
    }

    slides[lastIndex - 1] = trial[lastIndex - 1];
    slides[lastIndex] = trial[lastIndex];
    results[lastIndex - 1] = { ...prev, overflowPx: prevResult.overflowPx, fillPct: prevResult.fillPct };
    results[lastIndex] = { ...last, overflowPx: lastResult.overflowPx, fillPct: lastResult.fillPct };
  }
}
