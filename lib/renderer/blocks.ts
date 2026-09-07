import type { Block } from '../schema';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const e = escapeHtml;

/**
 * Page text is written the way the author types it — with markdown inline code around
 * identifiers. Rendering it raw put a literal backtick on screen roughly thirteen times a
 * page, so `git stash` becomes a tinted monospace span and the ticks disappear. A lone
 * unmatched tick stays visible, because it is almost always meant as a shell character.
 */
export function rich(s: string): string {
  let out = '';
  let last = 0;
  const inline = /`([^`\n]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = inline.exec(s))) {
    out += e(s.slice(last, m.index)) + `<code class="b-inline">${e(m[1])}</code>`;
    last = m.index + m[0].length;
  }
  return out + e(s.slice(last));
}

/**
 * Section numbers belong to the page, not to the author: the layout decides what ends up
 * on a page and in which column, and authored numbering ran to "54." on page ten of one
 * chapter. Numbers written by hand are stripped here and re-applied per page.
 */
export function stripHeadingNumber(text: string): string {
  return text.replace(/^\s*\d+\s*[.)]\s*/, '');
}

// Ink CSS var per logical ink name; templates define the actual colors.
function inkVar(ink?: string) {
  return `var(--ink-${ink ?? 'blue'})`;
}

function heading(b: Extract<Block, { type: 'heading' }>, num?: number) {
  const cls = b.ink ? ` ink-${b.ink}` : '';
  const label = stripHeadingNumber(b.text);
  const prefix = num ? `${num}. ` : '';
  return `<div class="b-heading${cls}" data-jitter>${e(prefix)}${rich(label)}</div>`;
}

function paragraph(b: Extract<Block, { type: 'paragraph' }>) {
  return `<div class="b-paragraph" data-jitter>${rich(b.text)}</div>`;
}

function bullets(b: Extract<Block, { type: 'bullets' }>) {
  return `<ul class="b-bullets" data-jitter>${b.items.map((i) => `<li>${rich(i)}</li>`).join('')}</ul>`;
}

function sidebox(b: Extract<Block, { type: 'sidebox' }>) {
  return (
    `<div class="b-sidebox" data-rough="${inkVar(b.ink ?? 'green')}">` +
    `<div class="sb-title" data-jitter>${rich(b.title)}</div>` +
    `<ul data-jitter>${b.items.map((i) => `<li>${rich(i)}</li>`).join('')}</ul></div>`
  );
}

function table(b: Extract<Block, { type: 'table' }>) {
  const head = `<tr>${b.headers.map((h) => `<th data-jitter>${rich(h)}</th>`).join('')}</tr>`;
  const rows = b.rows
    .map((r) => `<tr>${r.map((c) => `<td data-jitter>${rich(c)}</td>`).join('')}</tr>`)
    .join('');
  return `<table class="b-table">${head}${rows}</table>`;
}

function code(b: Extract<Block, { type: 'code' }>) {
  // No jitter on code: monospace legibility beats realism.
  return `<div class="b-code">${b.lines.map(e).join('\n')}</div>`;
}

const node = (text: string, ink = 'var(--ink-blue)') =>
  `<span class="dg-node" data-rough="${ink}" data-jitter>${rich(text)}</span>`;

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

function flowDiagram(spec: Record<string, unknown>) {
  const inner = strings(spec.nodes).map((n) => node(n)).join('<span class="dg-arrow">→</span>');
  return `<div class="dg-flow">${inner}</div>`;
}

/** {"root":"call stack","branches":[{"label":"sync","children":["runs now"]}]} */
function treeDiagram(spec: Record<string, unknown>) {
  const raw = Array.isArray(spec.branches) ? spec.branches : [];
  const branches = raw.map((b) => {
    const item = (b ?? {}) as { label?: unknown; children?: unknown };
    const leaves = strings(item.children)
      .map((c) => `<li data-jitter>${rich(c)}</li>`)
      .join('');
    return (
      `<div class="dg-branch">${node(String(item.label ?? ''), 'var(--ink-green)')}` +
      (leaves ? `<ul class="dg-leaves">${leaves}</ul>` : '') +
      `</div>`
    );
  });
  return (
    `<div class="dg-tree"><div class="dg-tree-root">${node(String(spec.root ?? ''))}</div>` +
    `<div class="dg-tree-row">${branches.join('')}</div></div>`
  );
}

/** {"left":{"title":"stash","items":[...]},"right":{"title":"worktree","items":[...]}} */
function compareDiagram(spec: Record<string, unknown>) {
  const side = (v: unknown, ink: string) => {
    const s = (v ?? {}) as { title?: unknown; items?: unknown };
    const items = strings(s.items).map((i) => `<li data-jitter>${rich(i)}</li>`).join('');
    return (
      `<div class="dg-side" data-rough="${ink}">` +
      `<div class="dg-side-title" data-jitter>${rich(String(s.title ?? ''))}</div>` +
      `<ul>${items}</ul></div>`
    );
  };
  return (
    `<div class="dg-compare">${side(spec.left, 'var(--ink-blue)')}` +
    `<div class="dg-vs" data-jitter>vs</div>` +
    `${side(spec.right, 'var(--ink-red)')}</div>`
  );
}

/** {"label":"arr","cells":["10","20"]} — cells may also be {"value":..,"addr":..} objects. */
function memoryCellsDiagram(spec: Record<string, unknown>) {
  const raw = Array.isArray(spec.cells) ? spec.cells : [];
  const cells = raw.map((c, i) => {
    const cell = (typeof c === 'object' && c !== null ? c : { value: c }) as {
      value?: unknown;
      addr?: unknown;
    };
    const addr = cell.addr ?? i;
    return (
      `<div class="dg-cell" data-rough="var(--ink-blue)">` +
      `<span class="dg-cell-v" data-jitter>${rich(String(cell.value ?? ''))}</span>` +
      `<span class="dg-cell-i" data-jitter>${rich(String(addr))}</span></div>`
    );
  });
  const label = spec.label ? `<div class="dg-mem-label" data-jitter>${rich(String(spec.label))}</div>` : '';
  return `<div class="dg-mem">${label}<div class="dg-mem-row">${cells.join('')}</div></div>`;
}

function diagram(b: Extract<Block, { type: 'diagram' }>) {
  const spec = b.spec as Record<string, unknown>;
  const body =
    b.kind === 'tree' ? treeDiagram(spec)
    : b.kind === 'compare' ? compareDiagram(spec)
    : b.kind === 'memory-cells' ? memoryCellsDiagram(spec)
    : flowDiagram(spec);
  return `<div class="b-diagram dg-${b.kind}-wrap">${body}</div>`;
}

function callout(b: Extract<Block, { type: 'callout' }>) {
  const icon = b.style === 'tip' ? '💡 ' : b.style === 'takeaway' ? '★ ' : '';
  const ink = b.style === 'cloud' ? 'var(--ink-green)' : 'var(--ink-red)';
  return (
    `<div class="b-callout co-${b.style}" data-rough="${ink}">` +
    `<div class="co-title" data-jitter>${icon}${rich(b.title)}</div>` +
    `<div class="co-text" data-jitter>${rich(b.text)}</div></div>`
  );
}

function qa(b: Extract<Block, { type: 'qa' }>) {
  const codeHtml = b.example_code?.length
    ? `<div class="b-code">${b.example_code.map(e).join('\n')}</div>`
    : '';
  return (
    `<div class="b-qa">` +
    `<div class="qa-q" data-jitter>${rich(b.q)}</div>` +
    `<div class="qa-a"><span class="qa-ans-label" data-jitter>Ans→</span>` +
    `<ul data-jitter>${b.a_bullets.map((i) => `<li>${rich(i)}</li>`).join('')}</ul></div>` +
    codeHtml +
    `</div>`
  );
}

function forcesFullWidth(block: Block): boolean {
  // A flow runs left to right and cells sit in a row, so both need the page width. A tree
  // or a comparison is as happy in one column, and forcing it wide strands the other one.
  if (block.type === 'diagram') return block.kind === 'flow' || block.kind === 'memory-cells';
  if (block.type === 'table' && block.headers.length >= 4) return true;
  return false;
}

/**
 * Wraps each block in a packing unit the layout engine can measure and place. Headings are
 * numbered here, per page: pagination decides which blocks share a page, so the count has
 * to be taken after that, and it restarts on every page the way study notes do.
 */
export function renderSlideBlocks(blocks: Block[]): string {
  let headingNo = 0;
  return blocks
    .map((b, i) => {
      const full = forcesFullWidth(b) ? ' data-force-full="1"' : '';
      const num = b.type === 'heading' ? ++headingNo : undefined;
      return `<div class="pk-unit" data-block-index="${i}" data-block-type="${b.type}"${full}>${renderBlockHtml(b, num)}</div>`;
    })
    .join('\n');
}

export function renderBlockHtml(block: Block, headingNumber?: number): string {
  switch (block.type) {
    case 'heading': return heading(block, headingNumber);
    case 'paragraph': return paragraph(block);
    case 'bullets': return bullets(block);
    case 'sidebox': return sidebox(block);
    case 'table': return table(block);
    case 'code': return code(block);
    case 'diagram': return diagram(block);
    case 'callout': return callout(block);
    case 'qa': return qa(block);
  }
}
