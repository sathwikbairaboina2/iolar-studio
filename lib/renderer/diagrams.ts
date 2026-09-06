import type { Block } from '../schema';
import { escapeHtml } from './inline';
import { t } from './text';

type D = Extract<Block, { type: 'diagram' }>;
const ink = (name?: string) => `var(--ink-${name ?? 'blue'})`;

function flow(spec: Extract<D, { kind: 'flow' }>['spec']): string {
  const inner = spec.nodes
    .map((n) => {
      if (typeof n === 'string') return `<span class="dg-node" data-rough="${ink()}" data-jitter>${t(n)}</span>`;
      const sub = n.sub ? `<div class="dg-sub">${t(n.sub)}</div>` : '';
      return `<span class="dg-node dg-node-rich" data-rough="${ink(n.ink)}" data-jitter><div class="dg-title">${t(n.text)}</div>${sub}</span>`;
    })
    .join('<span class="dg-arrow">→</span>');
  return `<div class="b-diagram"><div class="dg-flow">${inner}</div></div>`;
}

function array(spec: Extract<D, { kind: 'array' }>['spec']): string {
  const n = spec.cells.length;
  const hl = new Set(spec.highlight);
  const dim = new Set(spec.dim);
  const idx = spec.indices ? spec.cells.map((_, i) => `<div class="ar-idx">${i}</div>`).join('') : '';
  const cells = spec.cells
    .map((c, i) => `<div class="ar-cell${hl.has(i) ? ' ar-hl' : ''}${dim.has(i) ? ' ar-dim' : ''}" data-rough="${dim.has(i) ? 'var(--rule, #999)' : 'var(--ink-black)'}">${t(c)}</div>`)
    .join('');
  const byIndex = new Map<number, typeof spec.pointers>();
  for (const p of spec.pointers) byIndex.set(p.index, [...(byIndex.get(p.index) ?? []), p]);
  const ptrs = spec.cells
    .map((_, i) => {
      const ps = byIndex.get(i) ?? [];
      const labels = ps.map((p) => `<div class="ar-ptr-label" style="color:${ink(p.ink)}">${t(p.label)}</div>`).join('');
      return `<div class="ar-ptr">${ps.length ? `<div class="ar-ptr-arrow" style="color:${ink(ps[0].ink)}">↑</div>${labels}` : ''}</div>`;
    })
    .join('');
  const caption = spec.caption ? `<div class="ar-caption" data-rough="var(--ink-green)" data-jitter>${t(spec.caption)}</div>` : '';
  return `<div class="b-diagram dg-array" style="--ar-cols:${n}"><div class="ar-grid">${idx}${cells}${ptrs}</div>${caption}</div>`;
}

function flowchart(spec: Extract<D, { kind: 'flowchart' }>['spec']): string {
  const rows = spec.rows
    .map((ids) => {
      const nodes = ids
        .map((id) => {
          const nd = spec.nodes[id];
          // A diamond drawn at the box's edge midpoints contains the text only when the box is
          // about twice the text: pad it by the text's estimated width and one line height.
          const pad = nd.shape === 'diamond' ? ` style="padding:.85em ${(nd.text.length * 0.3).toFixed(1)}em"` : '';
          return `<div class="fc-node fc-${nd.shape}" data-id="${escapeHtml(id)}" data-rough="${ink(nd.ink)}" data-rough-shape="${nd.shape}"${pad} data-jitter><span>${t(nd.text)}</span></div>`;
        })
        .join('');
      return `<div class="fc-row">${nodes}</div>`;
    })
    .join('');
  const edges = escapeHtml(JSON.stringify(spec.edges));
  return `<div class="b-diagram dg-flowchart" data-edges="${edges}">${rows}<svg class="fc-edges"></svg></div>`;
}

function matrix(spec: Extract<D, { kind: 'matrix' }>['spec']): string {
  const hl = new Set(spec.highlight.map(([r, c]) => `${r},${c}`));
  const body = spec.rows
    .map((row, r) => `<tr>${row.map((c, ci) => `<td${hl.has(`${r},${ci}`) ? ' class="mx-hl"' : ''} data-jitter>${t(c)}</td>`).join('')}</tr>`)
    .join('');
  const caption = spec.caption ? `<div class="mx-caption" data-jitter>${t(spec.caption)}</div>` : '';
  return `<div class="b-diagram dg-matrix"><table class="mx">${body}</table>${caption}</div>`;
}

function cards(spec: Extract<D, { kind: 'cards' }>['spec']): string {
  const items = spec.cards
    .map((c) => `<div class="card" data-rough="${ink(c.ink)}"><div class="card-title" style="color:${ink(c.ink)}" data-jitter>${t(c.title)}</div><ul data-jitter>${c.lines.map((l) => `<li>${t(l)}</li>`).join('')}</ul></div>`)
    .join('');
  return `<div class="b-diagram dg-cards" style="--card-cols:${spec.cards.length}">${items}</div>`;
}

export function renderDiagram(b: D): string {
  switch (b.kind) {
    case 'flow': return flow(b.spec);
    case 'array': return array(b.spec);
    case 'flowchart': return flowchart(b.spec);
    case 'matrix': return matrix(b.spec);
    case 'cards': return cards(b.spec);
  }
}
