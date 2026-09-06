import type { Block, Frame, Cover } from '../schema';
import { iconSvg } from './icons';
import { escapeHtml } from './inline';
import { t } from './text';
import { highlightLine } from './syntax';
import { renderDiagram } from './diagrams';
export { escapeHtml };

const e = escapeHtml;

export type RenderOpts = { defaults?: { frame?: Frame }; pageTitle?: string };

/** "1. Binary Search Fundamentals" and "Binary Search Fundamentals" are the same title. */
function sameTitle(a: string, b: string): boolean {
  const norm = (x: string) => x.toLowerCase().replace(/^\s*\d+[.):\-\s]*/, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return norm(a) === norm(b) && norm(a).length > 0;
}

export const CODE_FULL_AT = 34;
export const CODE_SMALL_AT = 60;
export const CODE_TRUNCATE_AT = 80;

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

function inkVar(ink?: string) {
  return `var(--ink-${ink ?? 'blue'})`;
}

function heading(b: Extract<Block, { type: 'heading' }>) {
  const cls = b.ink ? ` ink-${b.ink}` : '';
  return `<div class="b-heading${cls}" data-jitter>${e(b.text)}</div>`;
}

function paragraph(b: Extract<Block, { type: 'paragraph' }>) {
  return `<div class="b-paragraph" data-jitter>${t(b.text)}</div>`;
}

function bullets(b: Extract<Block, { type: 'bullets' }>) {
  const style = b.style ?? 'dot';
  const items = b.items
    .map((item, i) => {
      const glyph = style === 'number' ? `<span class="bl-glyph">${CIRCLED[i] ?? `${i + 1}.`}</span>` : '';
      return `<li>${glyph}${t(item)}</li>`;
    })
    .join('');
  return `<ul class="b-bullets bl-${style}" data-jitter>${items}</ul>`;
}

function sidebox(b: Extract<Block, { type: 'sidebox' }>) {
  return (
    `<div class="b-sidebox" data-rough="${inkVar(b.ink ?? 'green')}">` +
    `<div class="sb-title" data-jitter>${t(b.title)}</div>` +
    `<ul data-jitter>${b.items.map((i) => `<li>${t(i)}</li>`).join('')}</ul></div>`
  );
}

function table(b: Extract<Block, { type: 'table' }>) {
  const head = `<tr>${b.headers.map((h) => `<th data-jitter>${t(h)}</th>`).join('')}</tr>`;
  const rows = b.rows
    .map((r, i) => `<tr${i === b.highlightRow ? ' class="hl-row"' : ''}>${r.map((c) => `<td data-jitter>${t(c)}</td>`).join('')}</tr>`)
    .join('');
  return `<table class="b-table">${head}${rows}</table>`;
}

function longestLine(lines: string[]): number {
  return lines.reduce((m, l) => Math.max(m, l.length), 0);
}

function code(b: Extract<Block, { type: 'code' }>) {
  // No jitter on code: legibility beats realism. Lines never wrap; long ones step down or truncate.
  const lines = b.lines.map((l) => (l.length > CODE_TRUNCATE_AT ? l.slice(0, CODE_TRUNCATE_AT) + '…' : l));
  const cls = ['b-code', longestLine(lines) > CODE_SMALL_AT ? 'code-small' : '', b.note ? 'has-note' : ''].filter(Boolean).join(' ');
  // The note is a chip under the last line, so a short snippet keeps its column.
  const note = b.note ? `<div class="code-note co-sticky"><span class="co-pin">📌</span>${t(b.note)}</div>` : '';
  return `<div class="${cls}" data-lang="${e(b.lang)}"><pre>${lines.map((l) => highlightLine(b.lang, l)).join('\n')}</pre>${note}</div>`;
}

function callout(b: Extract<Block, { type: 'callout' }>) {
  if (b.style === 'sticky' || b.style === 'sticky-pink') {
    return (
      `<div class="b-callout co-sticky${b.style === 'sticky-pink' ? ' co-sticky-pink' : ''}">` +
      `<span class="co-pin">📌</span>` +
      `<div class="co-title" data-jitter>${t(b.title)}</div>` +
      `<div class="co-text" data-jitter>${t(b.text)}</div></div>`
    );
  }
  const icon = b.style === 'tip' ? '💡 ' : b.style === 'takeaway' ? '★ ' : '';
  const ink = b.style === 'cloud' ? 'var(--ink-pink)' : 'var(--ink-red)';
  const shape = b.style === 'cloud' ? ' data-rough-shape="cloud"' : '';
  return (
    `<div class="b-callout co-${b.style}" data-rough="${ink}"${shape}>` +
    `<div class="co-title" data-jitter>${icon}${t(b.title)}</div>` +
    `<div class="co-text" data-jitter>${t(b.text)}</div></div>`
  );
}

function qa(b: Extract<Block, { type: 'qa' }>) {
  const codeHtml = b.example_code?.length
    ? `<div class="b-code"><pre>${b.example_code.map((l) => highlightLine('python', l)).join('\n')}</pre></div>`
    : '';
  return (
    `<div class="b-qa">` +
    `<div class="qa-q" data-jitter>${t(b.q)}</div>` +
    `<div class="qa-a"><span class="qa-ans-label" data-jitter>Ans→</span>` +
    `<ul data-jitter>${b.a_bullets.map((i) => `<li>${t(i)}</li>`).join('')}</ul></div>` +
    codeHtml +
    `</div>`
  );
}

function frameOf(block: Block, opts?: RenderOpts): Frame {
  // A table draws its own rules, so it takes a frame only when asked for one.
  if (block.type === 'table') return block.frame ?? 'none';
  if (block.type !== 'bullets' && block.type !== 'paragraph') return 'none';
  return block.frame ?? opts?.defaults?.frame ?? 'none';
}

function withFrame(block: Block, inner: string, opts?: RenderOpts): string {
  const frame = frameOf(block, opts);
  if (frame === 'none') return inner;
  const ink = 'ink' in block && block.ink ? block.ink : 'blue';
  const dash = frame === 'dashed' ? ' data-rough-dash="1"' : '';
  return `<div class="b-frame" data-rough="${inkVar(ink)}"${dash}>${inner}</div>`;
}

export function renderBlockHtml(block: Block, opts?: RenderOpts): string {
  let inner: string;
  switch (block.type) {
    case 'heading': inner = heading(block); break;
    case 'paragraph': inner = paragraph(block); break;
    case 'bullets': inner = bullets(block); break;
    case 'sidebox': inner = sidebox(block); break;
    case 'table': inner = table(block); break;
    case 'code': inner = code(block); break;
    case 'diagram': inner = renderDiagram(block); break;
    case 'callout': inner = callout(block); break;
    case 'qa': inner = qa(block); break;
  }
  return withFrame(block, inner, opts);
}

export function forcesFullWidth(block: Block): boolean {
  if (block.type === 'table') {
    // Five columns always need the width; four do only when a cell is long enough to wrap badly.
    const longest = Math.max(...block.headers.map((h) => h.length), ...block.rows.flat().map((c) => c.length));
    return block.headers.length >= 5 || (block.headers.length === 4 && longest > 12) || (block.headers.length === 3 && longest > 18);
  }
  if (block.type === 'code') return longestLine(block.lines) > CODE_FULL_AT;
  if (block.type === 'diagram') {
    switch (block.kind) {
      // A flowchart is a narrow column and an array up to ten cells fits beside other content.
      case 'cards': case 'er': return true;
      case 'flowchart': case 'chain': return false;
      case 'array': return block.spec.cells.length > 10;
      case 'flow': return block.spec.nodes.length >= 4;
      case 'matrix': return block.spec.rows.some((r) => r.length > 4);
      case 'tables': return block.spec.tables.length > 2 || block.spec.tables.reduce((n, t) => n + t.headers.length, 0) >= 6;
      case 'schema': return block.spec.tables.length > 2;
    }
  }
  return false;
}

/** The cover page: giant title, logo, tagline, an icon strip and a pill list. Families style `.cover-*`. */
export function renderCover(cover: Cover, hero?: string): string {
  const logo = hero ? `<div class="cover-logo">${iconSvg(hero)}</div>` : '';
  const icons = cover.icons.length
    ? `<div class="cover-icons" style="--cover-cols:${cover.icons.length}">${cover.icons
        .map((i) => `<div class="cover-icon">${iconSvg(i.icon)}<div class="cover-icon-label" data-jitter>${t(i.label)}</div>${i.sub ? `<div class="cover-icon-sub" data-jitter>${t(i.sub)}</div>` : ''}</div>`)
        .join('')}</div>`
    : '';
  const pills = cover.pills.length ? `<div class="cover-pills" data-rough="var(--ink-purple)" data-jitter>${cover.pills.map((p) => `<span>${t(p)}</span>`).join('<span class="cover-dot">•</span>')}</div>` : '';
  return (
    `<div class="cover">` +
    `<div class="cover-title" data-jitter>${t(cover.title)}</div>` +
    (cover.subtitle ? `<div class="cover-sub" data-jitter>${t(cover.subtitle)}</div>` : '') +
    logo +
    (cover.tagline ? `<div class="cover-tagline" data-rough="var(--ink-blue)" data-jitter>${t(cover.tagline)}</div>` : '') +
    icons + pills +
    `</div>`
  );
}

/** Render-time warnings that do not block a render but the report should carry. */
export function collectWarnings(blocks: Block[]): string[] {
  const out: string[] = [];
  blocks.forEach((b, i) => {
    if (b.type === 'code') {
      b.lines.forEach((l, li) => {
        if (l.length > CODE_TRUNCATE_AT) out.push(`block ${i}: code line ${li + 1} truncated at ${CODE_TRUNCATE_AT} chars`);
      });
    }
  });
  return out;
}

/** Wraps each block in a packing unit the layout engine can measure and place. */
export function renderSlideBlocks(blocks: Block[], opts?: RenderOpts): string {
  return blocks
    .map((b, i) => {
      const full = forcesFullWidth(b) ? ' data-force-full="1"' : '';
      // A first heading that only repeats the page title is dead weight on the page. It stays
      // in the DOM (block indexes must line up with the post) but renders nothing.
      const hidden = i === 0 && b.type === 'heading' && opts?.pageTitle && sameTitle(b.text, opts.pageTitle) ? ' pk-hidden' : '';
      return `<div class="pk-unit${hidden}" data-block-index="${i}" data-block-type="${b.type}"${full}>${renderBlockHtml(b, opts)}</div>`;
    })
    .join('\n');
}
