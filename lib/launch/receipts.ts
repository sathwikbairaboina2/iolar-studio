import { promises as fs } from 'fs';
import path from 'path';
import { launchAssetsDir } from '@/lib/paths';
import type { Rect, ReceiptShot } from './edit';
import type { Claims } from './schema';
import { readReceipts, writeReceipts } from './store';

/**
 * A receipt is the claim's page, screenshotted as a phone sees it, with the quote's lines located so the render can
 * sweep a marker over exactly those words. The matching runs inside the page, so it is kept as plain JavaScript source.
 */
export const FIND_QUOTE_JS = String.raw`
function findQuoteSpan(texts, quote) {
  function fold(c) { return c.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-'); }
  var chars = [], map = [], prevSpace = true;
  for (var n = 0; n < texts.length; n++) {
    var t = texts[n];
    for (var i = 0; i < t.length; i++) {
      var c = t[i];
      if (/\s/.test(c)) { if (prevSpace) continue; c = ' '; prevSpace = true; } else { c = fold(c); prevSpace = false; }
      chars.push(c); map.push([n, i]);
    }
  }
  var hay = chars.join('');
  var q = fold(quote.replace(/\s+/g, ' ').trim());
  var at = hay.indexOf(q);
  if (at < 0 || !q.length) return null;
  var s = map[at], e = map[at + q.length - 1];
  return { startNode: s[0], startOffset: s[1], endNode: e[0], endOffset: e[1] + 1 };
}`;

/** Runs in the page: finds the quote among the visible text nodes and returns one rectangle per line, in page pixels. */
const LOCATE_JS = String.raw`(function (quote) {
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: function (node) {
    var p = node.parentElement; if (!p) return NodeFilter.FILTER_REJECT;
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(p.tagName)) return NodeFilter.FILTER_REJECT;
    var cs = getComputedStyle(p); return cs.display === 'none' || cs.visibility === 'hidden' ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
  } });
  var nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  var span = findQuoteSpan(nodes.map(function (n) { return n.data; }), quote);
  if (!span) return null;
  var r = document.createRange();
  r.setStart(nodes[span.startNode], span.startOffset); r.setEnd(nodes[span.endNode], span.endOffset);
  var rects = Array.prototype.slice.call(r.getClientRects()).filter(function (b) { return b.width > 1 && b.height > 1; });
  return rects.map(function (b) { return { x: b.left + window.scrollX, y: b.top + window.scrollY, w: b.width, h: b.height }; });
})`;

/**
 * Runs in the page before the screenshot: declines a cookie or consent banner (the private choice), then hides any
 * banner still pinned over the page, so the receipt shows the page and not the dialog. One expression.
 */
export const DISMISS_JS = String.raw`(function () {
  var no = /^(reject( all)?|decline( all)?|deny|refuse( all)?|only (necessary|essential)|(use )?necessary( cookies)? only|essential only)$/i;
  var buttons = Array.prototype.slice.call(document.querySelectorAll('button, [role="button"], a'));
  buttons.forEach(function (b) { if (no.test((b.innerText || '').trim())) { try { b.click(); } catch (e) {} } });
  var banner = /cookie|consent|gdpr|onetrust|privacy-banner/i;
  Array.prototype.slice.call(document.querySelectorAll('body *')).forEach(function (el) {
    var cs = getComputedStyle(el);
    if ((cs.position === 'fixed' || cs.position === 'sticky') && banner.test((el.id || '') + ' ' + (el.className || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.innerText || '').slice(0, 200))) el.style.display = 'none';
  });
  return true;
})()`;

/** The page-side script as one expression (page.evaluate takes an expression, not statements): the quote's line rectangles, or null. */
export const locateScript = (quote: string): string => `(function () { ${FIND_QUOTE_JS}
 return ${LOCATE_JS}(${JSON.stringify(quote)}); })()`;

export function toClip(rects: Rect[], clipTop: number, scale: number): Rect[] {
  return rects.map((r) => ({ x: r.x * scale, y: (r.y - clipTop) * scale, w: r.w * scale, h: r.h * scale }));
}

export type Capture = (url: string, quote: string, outPng: string) => Promise<{ width: number; height: number; focus: Rect[] | null }>;

// A real phone's width: body text comes out near 40 px in the reel, and quoted lines are short enough to fit the card.
const VIEW = { width: 390, height: 844 };
const CLIP_H = 450; // 1170 x 1350 at device scale 3
const SCALE = 3;

/** One browser for a whole stage; close it when the stage ends. */
export async function playwrightCapture(): Promise<{ capture: Capture; close: () => Promise<void> }> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: SCALE });
  const capture: Capture = async (url, quote, outPng) => {
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
      await page.evaluate(DISMISS_JS).catch(() => undefined);
      await page.waitForTimeout(400);
      const found = (await page.evaluate(locateScript(quote))) as Rect[] | null;
      const docH = (await page.evaluate('document.documentElement.scrollHeight')) as number;
      const top = found?.length ? Math.max(0, Math.min(found[0].y - 180, docH - CLIP_H)) : 0;
      await page.screenshot({ path: outPng, fullPage: true, clip: { x: 0, y: top, width: VIEW.width, height: CLIP_H } });
      return { width: VIEW.width * SCALE, height: CLIP_H * SCALE, focus: found?.length ? toClip(found, top, SCALE) : null };
    } finally {
      await page.close();
    }
  };
  return { capture, close: () => browser.close() };
}

export async function captureReceipts(slug: string, claims: Claims, ids: readonly string[], capture: Capture): Promise<Record<string, ReceiptShot>> {
  const dir = launchAssetsDir(slug);
  await fs.mkdir(dir, { recursive: true });
  const known = (await readReceipts(slug)) ?? {};
  const byId = new Map(claims.claims.map((c) => [c.id, c]));
  const out: Record<string, ReceiptShot> = { ...known };
  for (const id of ids) {
    const c = byId.get(id);
    if (!c) continue;
    const file = `receipt-${id}.png`;
    const host = new URL(c.url).hostname.replace(/^www\./, '');
    const prev = known[id];
    const pngThere = await fs.access(path.join(dir, file)).then(() => true, () => false);
    if (prev && prev.url === c.url && prev.quote === c.quote && prev.focus && pngThere) continue;
    try {
      const shot = await capture(c.url, c.quote, path.join(dir, file));
      out[id] = { claim: id, file, ...shot, url: c.url, quote: c.quote, host };
    } catch {
      out[id] = { claim: id, file, width: 1080, height: 1350, focus: null, url: c.url, quote: c.quote, host };
    }
  }
  await writeReceipts(slug, out);
  return out;
}
