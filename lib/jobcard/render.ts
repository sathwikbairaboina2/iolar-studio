import { promises as fs } from 'fs';
import path from 'path';
import { chromium, Browser } from 'playwright';
import sharp from 'sharp';
import { Family, JobCard, ratioFor } from './schema';
import { buildCardHtml, jobcardRoot } from './build';
import { FALLBACK } from './pick';

/**
 * A card is screenshotted the way a slide is: the HTML is written beside its own
 * template so `../_shared` resolves, chromium opens it at the card's size on a
 * doubled device scale, and sharp brings the shot back down. The one thing a card
 * checks that a slide does not is whether it ran out of room — a fixed panel that
 * overflows is a card with a sentence cut in half, and the answer to that is not a
 * smaller font but a different family.
 */

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

export type CardRender = {
  family: Family;
  file: string;
  width: number;
  height: number;
  /** How far the card's content ran past its own frame. Zero is the only good answer. */
  overflowPx: number;
  /** True when the asked-for family could not hold the document and band-stack rendered instead. */
  fellBack: boolean;
};

/** Renders exactly the family asked for, overflow reported rather than fixed. */
export async function renderFamily(
  card: JobCard,
  family: Family,
  outPath: string,
  opts: { brand?: string } = {}
): Promise<Omit<CardRender, 'fellBack'>> {
  const [w, h] = ratioFor(family);
  const html = buildCardHtml(card, family, opts);

  // A temp file inside the family's own directory, so ../_shared/card.css and the
  // fonts beside it resolve exactly as they do for the template itself.
  const tmpFile = path.join(jobcardRoot(), family, `.render-${process.pid}-${Date.now()}.html`);
  await fs.writeFile(tmpFile, html);

  try {
    const browser = await getBrowser();
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    try {
      await page.goto('file://' + tmpFile.replace(/\\/g, '/'));
      await page.evaluate(() => document.fonts.ready);

      const overflowPx = await page.evaluate(() => {
        const card = document.getElementById('card');
        if (!card) return 0;
        // The frame clips, so a sentence past the bottom is invisible rather than
        // ragged: scrollHeight is what says it happened at all.
        const own = card.scrollHeight - card.clientHeight;
        // A family whose regions clip on their own (a stub, a panel) hides its own
        // spill from the card, so every region is asked too.
        let worst = 0;
        card.querySelectorAll<HTMLElement>('*').forEach((el) => {
          if (getComputedStyle(el).overflow === 'hidden') worst = Math.max(worst, el.scrollHeight - el.clientHeight);
        });
        return Math.max(0, own, worst);
      });

      const shot = await page.screenshot({ type: 'png' });
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await sharp(shot).resize(w, h, { kernel: 'lanczos3' }).png().toFile(outPath);

      return { family, file: outPath, width: w, height: h, overflowPx };
    } finally {
      await page.close();
    }
  } finally {
    await fs.unlink(tmpFile).catch(() => {});
  }
}

/**
 * The card as it should be posted: the family asked for, or band-stack when that
 * family could not hold the document. A picked family is a preference, never a
 * promise to cut text to fit it.
 */
export async function renderCard(
  card: JobCard,
  family: Family,
  outPath: string,
  opts: { brand?: string } = {}
): Promise<CardRender> {
  const first = await renderFamily(card, family, outPath, opts);
  if (first.overflowPx === 0 || family === FALLBACK) return { ...first, fellBack: false };

  const fallback = await renderFamily(card, FALLBACK, outPath, opts);
  return { ...fallback, fellBack: true };
}
