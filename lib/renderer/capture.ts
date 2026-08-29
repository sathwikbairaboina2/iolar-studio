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

const MAX_AUTOFLOW_PAGES = 30; // guard against a single unsplittable block looping forever

export async function renderAll(
  post: Post,
  outDir: string
): Promise<{
  results: { slide: number; overflowPx: number; fillPct: number; file: string }[];
  slides: Post['slides'];
}> {
  // Merge continuation pages back into their parent first: re-rendering must re-split from
  // the authored content, otherwise each run splits an already-split page again and the
  // page count creeps upward with ever thinner tails.
  const slides: Post['slides'] = [];
  for (const s of post.slides) {
    const prev = slides[slides.length - 1];
    if (prev && s.cont) {
      prev.blocks.push(...s.blocks);
      continue;
    }
    slides.push({ ...s, blocks: [...s.blocks] });
  }

  const results: { slide: number; overflowPx: number; fillPct: number; file: string }[] = [];

  for (let i = 0; i < slides.length && i < MAX_AUTOFLOW_PAGES; i++) {
    const file = path.join(outDir, `slide-${String(i + 1).padStart(2, '0')}.png`);
    const working: Post = { ...post, slides };
    const r = await renderSlide(working, i, file);

    // A page whose every block spilled cannot be split further — keep it and move on.
    if (r.spillIndexes.length && r.spillIndexes.length < slides[i].blocks.length) {
      const spilled = new Set(r.spillIndexes);
      const kept = slides[i].blocks.filter((_, j) => !spilled.has(j));
      const moved = slides[i].blocks.filter((_, j) => spilled.has(j));
      const title = slides[i].page_title.replace(/ \(cont\.\)$/, '');
      slides[i] = { ...slides[i], blocks: kept };
      slides.splice(i + 1, 0, { page_title: `${title} (cont.)`, blocks: moved, cont: true });
      i--; // re-render this page now that it is trimmed
      continue;
    }
    results.push({ slide: i + 1, overflowPx: r.overflowPx, fillPct: r.fillPct, file });
  }

  return { results, slides };
}
