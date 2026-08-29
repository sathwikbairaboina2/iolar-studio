import { promises as fs } from 'fs';
import path from 'path';
import { Browser, chromium } from 'playwright';
import { Pattern, patternCssVars } from './patterns';
import { REEL_RATIOS, Reel } from './schema';
import { patternDir } from '../paths';

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

export async function closeOverlayBrowser() {
  if (browserPromise) {
    const b = await browserPromise;
    browserPromise = null;
    await b.close();
  }
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The overlay page. It links the pattern's own caption.css — the same file the studio
 * preview links — so a caption burned into the export is styled by exactly one stylesheet.
 */
export function overlayHtml(pattern: Pattern, cssHref: string, body: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="${cssHref}">
<style>
  :root { ${patternCssVars(pattern)}; }
  html, body { margin: 0; padding: 0; background: transparent; }
  .reel-stage { position: relative; width: 100vw; height: 100vh; overflow: hidden; container-type: size; }
</style>
</head>
<body><div class="reel-stage">${body}</div></body>
</html>`;
}

export function captionMarkup(text: string): string {
  return `<div class="reel-caption"><span>${escapeHtml(text)}</span></div>`;
}

export function hookMarkup(template: string, title: string, logoSrc?: string): string {
  return template
    .replace(/\{\{title\}\}/g, escapeHtml(title))
    .replace(/\{\{logo\}\}/g, logoSrc ? `<img src="${logoSrc}" alt="">` : '');
}

export type OverlayRender = { id: string; file: string };

/**
 * Renders every distinct caption and overlay to a transparent PNG.
 * Identical caption text is rendered once and shared by every cue that uses it.
 */
export async function renderOverlays(
  reel: Reel,
  pattern: Pattern,
  outDir: string
): Promise<Map<string, string>> {
  const cues = reel.timeline.captions.filter((c) => !c.hidden);
  const overlays = reel.timeline.overlays;
  const out = new Map<string, string>();
  if (!cues.length && !overlays.length) return out;

  const [width, height] = REEL_RATIOS[reel.ratio];
  await fs.mkdir(outDir, { recursive: true });

  // The page is written INTO the pattern dir so `caption.css` resolves as a plain relative
  // href: a file:// stylesheet is not loadable from the about:blank origin setContent uses.
  const cssHref = 'caption.css';
  const pageFile = path.join(patternDir(pattern.name), `.overlay-${process.pid}-${Date.now()}.html`);
  let hookTemplate = '<div class="reel-hook-title">{{logo}}{{title}}</div>';
  try {
    hookTemplate = await fs.readFile(path.join(patternDir(pattern.name), 'hook.html'), 'utf8');
  } catch {
    // Pattern ships no hook markup; the default above is used.
  }

  const browser = await getBrowser();
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  try {
    const byContent = new Map<string, string>();
    let n = 0;

    const shoot = async (key: string, body: string, prefix: string): Promise<string> => {
      const cached = byContent.get(key);
      if (cached) return cached;
      n += 1;
      const file = path.join(outDir, `${prefix}-${String(n).padStart(3, '0')}.png`);
      await fs.writeFile(pageFile, overlayHtml(pattern, cssHref, body));
      await page.goto('file://' + pageFile.replace(/\\/g, '/'), { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: file, omitBackground: true });
      byContent.set(key, file);
      return file;
    };

    for (const cue of cues) {
      out.set(cue.id, await shoot(`cap:${cue.text}`, captionMarkup(cue.text), 'cap'));
    }
    for (const ov of overlays) {
      const title = String(ov.props?.title ?? '');
      const logo = ov.props?.logo ? 'file://' + String(ov.props.logo).replace(/\\/g, '/') : undefined;
      out.set(ov.id, await shoot(`hook:${title}:${logo ?? ''}`, hookMarkup(hookTemplate, title, logo), 'ovl'));
    }
  } finally {
    await page.close();
    await fs.unlink(pageFile).catch(() => {});
  }
  return out;
}
