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

export type RenderResult = { overflowPx: number; fillPct: number };

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
      await page.waitForSelector('body[data-jitter-done="1"]', { timeout: 15000 });
      await page.evaluate(() => document.fonts.ready);

      const { overflowPx, fillPct } = await page.evaluate((selector) => {
        const content = document.querySelector(selector) as HTMLElement | null;
        const pageEl = document.getElementById('page');
        if (!content || !pageEl) return { overflowPx: 0, fillPct: 0 };
        const pad = parseFloat(getComputedStyle(pageEl).paddingBottom);
        const usable = pageEl.clientHeight - pad;
        const bottom = content.offsetTop + content.scrollHeight;
        return {
          overflowPx: Math.max(0, Math.round(bottom - usable)),
          fillPct: Math.round((bottom / usable) * 100),
        };
      }, manifest.contentSelector);

      const shot = await page.screenshot({ type: 'png' });
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await sharp(shot).resize(w, h, { kernel: 'lanczos3' }).png().toFile(outPath);

      return { overflowPx, fillPct };
    } finally {
      await page.close();
    }
  } finally {
    await fs.unlink(tmpFile).catch(() => {});
  }
}

export async function renderAll(
  post: Post,
  outDir: string
): Promise<{ slide: number; overflowPx: number; fillPct: number; file: string }[]> {
  const results: { slide: number; overflowPx: number; fillPct: number; file: string }[] = [];
  for (let i = 0; i < post.slides.length; i++) {
    const file = path.join(outDir, `slide-${String(i + 1).padStart(2, '0')}.png`);
    const r = await renderSlide(post, i, file);
    results.push({ slide: i + 1, overflowPx: r.overflowPx, fillPct: r.fillPct, file });
  }
  return results;
}
