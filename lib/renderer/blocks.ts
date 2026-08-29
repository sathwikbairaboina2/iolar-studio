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

// Ink CSS var per logical ink name; templates define the actual colors.
function inkVar(ink?: string) {
  return `var(--ink-${ink ?? 'blue'})`;
}

function heading(b: Extract<Block, { type: 'heading' }>) {
  const cls = b.ink ? ` ink-${b.ink}` : '';
  return `<div class="b-heading${cls}" data-jitter>${e(b.text)}</div>`;
}

function paragraph(b: Extract<Block, { type: 'paragraph' }>) {
  return `<div class="b-paragraph" data-jitter>${e(b.text)}</div>`;
}

function bullets(b: Extract<Block, { type: 'bullets' }>) {
  return `<ul class="b-bullets" data-jitter>${b.items.map((i) => `<li>${e(i)}</li>`).join('')}</ul>`;
}

function sidebox(b: Extract<Block, { type: 'sidebox' }>) {
  return (
    `<div class="b-sidebox" data-rough="${inkVar(b.ink ?? 'green')}">` +
    `<div class="sb-title" data-jitter>${e(b.title)}</div>` +
    `<ul data-jitter>${b.items.map((i) => `<li>${e(i)}</li>`).join('')}</ul></div>`
  );
}

function table(b: Extract<Block, { type: 'table' }>) {
  const head = `<tr>${b.headers.map((h) => `<th data-jitter>${e(h)}</th>`).join('')}</tr>`;
  const rows = b.rows
    .map((r) => `<tr>${r.map((c) => `<td data-jitter>${e(c)}</td>`).join('')}</tr>`)
    .join('');
  return `<table class="b-table">${head}${rows}</table>`;
}

function code(b: Extract<Block, { type: 'code' }>) {
  // No jitter on code: monospace legibility beats realism.
  return `<div class="b-code">${b.lines.map(e).join('\n')}</div>`;
}

function diagram(b: Extract<Block, { type: 'diagram' }>) {
  if (b.kind === 'flow') {
    const nodes: string[] = Array.isArray(b.spec.nodes) ? b.spec.nodes.map(String) : [];
    const inner = nodes
      .map((n) => `<span class="dg-node" data-rough="var(--ink-blue)" data-jitter>${e(n)}</span>`)
      .join('<span class="dg-arrow">→</span>');
    return `<div class="b-diagram"><div class="dg-flow">${inner}</div></div>`;
  }
  // Staged: other diagram kinds render as a visible placeholder box until implemented.
  const keys = Object.keys(b.spec).join(', ');
  return `<div class="b-diagram-staged">[${e(b.kind)} diagram — ${e(keys)}]</div>`;
}

function callout(b: Extract<Block, { type: 'callout' }>) {
  const icon = b.style === 'tip' ? '💡 ' : b.style === 'takeaway' ? '★ ' : '';
  const ink = b.style === 'cloud' ? 'var(--ink-green)' : 'var(--ink-red)';
  return (
    `<div class="b-callout co-${b.style}" data-rough="${ink}">` +
    `<div class="co-title" data-jitter>${icon}${e(b.title)}</div>` +
    `<div class="co-text" data-jitter>${e(b.text)}</div></div>`
  );
}

function qa(b: Extract<Block, { type: 'qa' }>) {
  const codeHtml = b.example_code?.length
    ? `<div class="b-code">${b.example_code.map(e).join('\n')}</div>`
    : '';
  return (
    `<div class="b-qa">` +
    `<div class="qa-q" data-jitter>${e(b.q)}</div>` +
    `<div class="qa-a"><span class="qa-ans-label" data-jitter>Ans→</span>` +
    `<ul data-jitter>${b.a_bullets.map((i) => `<li>${e(i)}</li>`).join('')}</ul></div>` +
    codeHtml +
    `</div>`
  );
}

export function renderBlockHtml(block: Block): string {
  switch (block.type) {
    case 'heading': return heading(block);
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
