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

export async function renderAll(
  post: Post,
  outDir: string
): Promise<{
  results: { slide: number; overflowPx: number; fillPct: number; file: string; warnings: string[] }[];
  slides: Post['slides'];
}> {
  const authored = mergeContinuations(post.slides);

  // Blocks flow as one stream across chapter boundaries: a chapter that ends halfway down
  // a page is followed by the next chapter on the same page. Nothing is trimmed, and no
  // page is left half empty just because a chapter ended there. A cover slide is the one
  // exception: it is its own page, and the stream drains before it and restarts after it.
  type Item = { block: Post['slides'][number]['blocks'][number]; from: number };
  const results: { slide: number; overflowPx: number; fillPct: number; file: string; warnings: string[] }[] = [];
  const slides: Post['slides'] = [];
  const started = new Set<number>();
  let page = 0;

  const renderCoverPage = async (cover: Post['slides'][number]) => {
    const file = path.join(outDir, `slide-${String(page + 1).padStart(2, '0')}.png`);
    const working: Post = { ...post, slides: [...slides, cover] };
    const r = await renderSlide(working, page, file);
    slides.push(cover);
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
    const source = queue[0].from;
    const base = authored[source].page_title.replace(/ \(cont\.\)$/, '');
    const isCont = started.has(source);
    started.add(source);

    const src = authored[source];
    const candidate: Post['slides'][number] = {
      page_title: isCont ? `${base} (cont.)` : base,
      blocks: queue.map((q) => q.block),
      // Only a page continuing the SAME chapter is a continuation. Marking every page
      // after the first would make mergeContinuations collapse the whole post into one.
      ...(isCont ? { cont: true } : {}),
      // The chapter's hero logo and subtitle belong to every page cut from it.
      ...(src.hero ? { hero: src.hero } : {}),
      ...(src.subtitle ? { subtitle: src.subtitle } : {}),
    };

    const file = path.join(outDir, `slide-${String(page + 1).padStart(2, '0')}.png`);
    const working: Post = { ...post, slides: [...slides, candidate] };
    const r = await renderSlide(working, page, file);

    const spilled = new Set(r.spillIndexes);
    // Everything spilled: one block is taller than a page. Keep it alone rather than loop.
    const keepCount = spilled.size >= queue.length ? 1 : queue.length - spilled.size;
    const kept = queue.filter((_, j) => !spilled.has(j)).slice(0, Math.max(keepCount, 1));
    const keptSet = new Set(kept.map((k) => k.block));

    slides.push({ ...candidate, blocks: kept.map((k) => k.block) });
    results.push({ slide: page + 1, overflowPx: r.overflowPx, fillPct: r.fillPct, file, warnings: r.warnings });
    queue = queue.filter((q) => !keptSet.has(q.block));
  }
  }

  return { results, slides };
}
