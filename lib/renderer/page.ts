import { readFileSync } from 'fs';
import path from 'path';
import { Post, RATIOS } from '../schema';
import { renderBlockHtml } from './blocks';

export function templatesRoot() {
  return path.join(process.cwd(), 'templates');
}

export function templateManifest(template: string): { contentSelector: string; inks: Record<string, string> } {
  return JSON.parse(readFileSync(path.join(templatesRoot(), template, 'manifest.json'), 'utf8'));
}

export function builtTemplates(): string[] {
  const { readdirSync, existsSync } = require('fs') as typeof import('fs');
  return readdirSync(templatesRoot()).filter(
    (d) => !d.startsWith('_') && existsSync(path.join(templatesRoot(), d, 'template.html'))
  );
}

export function buildSlideHtml(post: Post, slideIndex: number): string {
  const slide = post.slides[slideIndex];
  const [width, height] = RATIOS[post.ratio];
  const tpl = readFileSync(path.join(templatesRoot(), post.template, 'template.html'), 'utf8');

  const head =
    `<link rel="stylesheet" href="../_shared/fonts.css">` +
    `<link rel="stylesheet" href="../_shared/base.css">`;

  const content = slide.blocks.map(renderBlockHtml).join('\n');

  const pageVars = `<script>window.PAGE = ${JSON.stringify({
    brand: post.brand,
    date: post.date,
    series: post.series,
    // Templates render their own "Page N" prefix; drop any the author typed.
    page_title: slide.page_title.replace(/^\s*page\s*\d+\s*[:.\-—]\s*/i, ''),
    pageNum: slideIndex + 1,
    pageCount: post.slides.length,
    seed: post.seed,
    width,
    height,
  })};</script>`;

  return tpl
    .replace('<!--HEAD-->', head)
    .replace('<!--CONTENT-->', content)
    .replace('<!--PAGEVARS-->', pageVars);
}
