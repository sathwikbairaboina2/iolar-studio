import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { Post, RATIOS } from '../schema';
import type { Frame } from '../schema';
import { renderSlideBlocks, renderCover } from './blocks';
import { iconSvg } from './icons';

export function templatesRoot() {
  return path.join(process.cwd(), 'templates');
}

export type TemplateManifest = {
  name: string;
  contentSelector: string;
  inks: Record<string, string>;
  maxColumns?: number;
  columnGap?: string;
  defaults?: { frame?: Frame };
  codeFont?: 'mono' | 'hand';
};

export function templateManifest(template: string): TemplateManifest {
  return JSON.parse(readFileSync(path.join(templatesRoot(), template, 'manifest.json'), 'utf8'));
}

export function builtTemplates(): string[] {
  const { readdirSync, existsSync } = require('fs') as typeof import('fs');
  return readdirSync(templatesRoot()).filter(
    (d) => !d.startsWith('_') && existsSync(path.join(templatesRoot(), d, 'template.html'))
  );
}

/** Newest mtime under templates/_shared: appended to script/style URLs so a long-lived Chromium never serves a stale file. */
function assetStamp(): string {
  const dir = path.join(templatesRoot(), '_shared');
  let newest = 0;
  for (const f of readdirSync(dir)) {
    try { newest = Math.max(newest, statSync(path.join(dir, f)).mtimeMs); } catch { /* ignore */ }
  }
  return String(Math.round(newest));
}

export function buildSlideHtml(post: Post, slideIndex: number): string {
  const slide = post.slides[slideIndex];
  const [width, height] = RATIOS[post.ratio];
  const tpl = readFileSync(path.join(templatesRoot(), post.template, 'template.html'), 'utf8');

  const manifest = templateManifest(post.template);
  const columns = manifest.maxColumns ?? 2;
  const columnGap = manifest.columnGap ?? '2.2vw';

  const v = assetStamp();
  const head =
    `<link rel="stylesheet" href="../_shared/fonts.css?v=${v}">` +
    `<link rel="stylesheet" href="../_shared/base.css?v=${v}">` +
    `<style>#content{--pk-cols:${columns};--pk-col-gap:${columnGap}}</style>`;

  const pageTitle = slide.page_title.replace(/^\s*page\s*\d+\s*[:.\-—]\s*/i, '').replace(/ \(cont\.\)$/, '');
  const isCover = slide.kind === 'cover' && slide.cover;
  const content = isCover
    ? renderCover(slide.cover!, slide.hero)
    : renderSlideBlocks(slide.blocks, { defaults: manifest.defaults, pageTitle });
  const codeClass = manifest.codeFont === 'hand' ? 'code-hand' : 'code-mono';
  const pageClass = `${codeClass}${isCover ? ' cover-page' : ''}${slide.hero ? ' has-hero' : ''}`;
  // The hero sits in the chrome, not the content flow: injected right inside #page so every
  // family gets it; families place it with CSS (#v-hero) or leave the base default.
  const heroHtml = slide.hero && !isCover ? `<div id="v-hero" class="hero">${iconSvg(slide.hero)}</div>` : '';

  const pageVars = `<script>window.PAGE = ${JSON.stringify({
    brand: post.brand,
    date: post.date,
    series: post.series,
    // Templates render their own "Page N" prefix; drop any the author typed.
    page_title: isCover ? slide.cover!.title : slide.page_title.replace(/^\s*page\s*\d+\s*[:.\-—]\s*/i, ''),
    subtitle: slide.subtitle ?? '',
    // The Instagram glyph for handle badges; families that want it read PAGE.brandIcon.
    brandIcon: iconSvg('instagram'),
    kind: slide.kind ?? 'page',
    pageNum: slideIndex + 1,
    pageCount: post.slides.length,
    seed: post.seed,
    width,
    height,
    columns,
    rowGapPx: Math.round(height * 2 * 0.006),
  })};</script>`;

  return tpl
    .replace(/src="\.\.\/_shared\/([a-z.]+\.js)"/g, `src="../_shared/$1?v=${v}"`)
    .replace('<!--HEAD-->', head)
    .replace('<!--CONTENT-->', content)
    .replace('<!--PAGEVARS-->', pageVars)
    .replace('<div id="page">', `<div id="page" class="${pageClass}">${heroHtml}`);
}
