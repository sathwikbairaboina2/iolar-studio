import type { Block } from '../schema';
import { escapeHtml } from './inline';
import { t } from './text';
import { iconSvg } from './icons';

type D = Extract<Block, { type: 'diagram' }>;
const ink = (name?: string) => `var(--ink-${name ?? 'blue'})`;
const e = escapeHtml;

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
          const icon = nd.icon ? iconSvg(nd.icon) : '';
          if (nd.shape === 'icon') {
            // Icon with a caption and no box: the reference's "service diagram" node.
            return `<div class="fc-node fc-icon" data-id="${e(id)}" style="color:${ink(nd.ink ?? 'black')}"><div class="fc-glyph">${icon || iconSvg('box')}</div><span data-jitter>${t(nd.text)}</span></div>`;
          }
          // A diamond drawn at the box's edge midpoints contains the text only when the box is
          // about twice the text: pad it by the text's estimated width and one line height.
          const pad = nd.shape === 'diamond' ? ` style="padding:.85em ${(nd.text.length * 0.3).toFixed(1)}em"` : '';
          return `<div class="fc-node fc-${nd.shape}" data-id="${e(id)}" data-rough="${ink(nd.ink)}" data-rough-shape="${nd.shape}"${pad} data-jitter>${icon ? `<span class="fc-node-icon">${icon}</span>` : ''}<span>${t(nd.text)}</span></div>`;
        })
        .join('');
      return `<div class="fc-row">${nodes}</div>`;
    })
    .join('');
  const edges = e(JSON.stringify(spec.edges));
  const title = spec.title ? `<div class="fc-title" data-jitter>${t(spec.title)}</div>` : '';
  const labelled = spec.edges.some((ed) => ed.label) ? ' fc-labelled' : '';
  const titled = spec.title ? ' dg-titled" data-rough="var(--ink-blue)" data-rough-dash="1' : '';
  return `<div class="b-diagram dg-flowchart${labelled}${titled}" data-edges="${edges}">${title}${rows}<svg class="fc-edges"></svg></div>`;
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
    .map((c) => {
      const icon = c.icon ? `<div class="card-icon">${iconSvg(c.icon)}</div>` : '';
      const text = c.text ? `<div class="card-text" data-jitter>${t(c.text)}</div>` : '';
      const lines = c.lines?.length ? `<ul data-jitter>${c.lines.map((l) => `<li>${t(l)}</li>`).join('')}</ul>` : '';
      const code = c.code?.length ? `<pre class="card-code">${c.code.map(e).join('\n')}</pre>` : '';
      const chain = c.chain?.length
        ? `<div class="card-chain">${c.chain.map((s) => `<div class="cc-box" data-rough="${ink(c.ink)}" data-jitter>${t(s)}</div>`).join('<div class="cc-arrow">↕</div>')}</div>`
        : '';
      return `<div class="card" data-rough="${ink(c.ink)}"><div class="card-title" style="color:${ink(c.ink)}" data-jitter>${t(c.title)}</div>${icon}${text}${lines}${code}${chain}</div>`;
    })
    .join('');
  return `<div class="b-diagram dg-cards cards-n${spec.cards.length}" style="--card-cols:${spec.cards.length}">${items}</div>`;
}

function chain(spec: Extract<D, { kind: 'chain' }>['spec']): string {
  const title = spec.title ? `<div class="ch-title" data-jitter>${t(spec.title)}</div>` : '';
  const steps = spec.steps
    .map((s) => `<div class="ch-row"><div class="ch-box" data-rough="${ink(s.ink)}" data-jitter>${t(s.text)}</div>${s.note ? `<div class="ch-note" data-jitter>${t(s.note)}</div>` : ''}</div>`)
    .join('<div class="ch-arrow">↓</div>');
  return `<div class="b-diagram dg-chain">${title}${steps}</div>`;
}

function tables(spec: Extract<D, { kind: 'tables' }>['spec']): string {
  const items = spec.tables
    .map((tb) => {
      const head = `<tr>${tb.headers.map((h) => `<th data-jitter>${t(h)}</th>`).join('')}</tr>`;
      const rows = tb.rows.map((r) => `<tr>${r.map((c) => `<td data-jitter>${t(c)}</td>`).join('')}</tr>`).join('');
      return `<div class="tb">${tb.title ? `<div class="tb-title" data-jitter>${t(tb.title)}</div>` : ''}<table class="b-table tb-mini">${head}${rows}</table>${tb.caption ? `<div class="tb-caption" data-jitter>${t(tb.caption)}</div>` : ''}</div>`;
    })
    .join(spec.arrow ? '<div class="tb-arrow">→</div>' : '');
  return `<div class="b-diagram dg-tables">${items}</div>`;
}

function schema(spec: Extract<D, { kind: 'schema' }>['spec']): string {
  const boxes = spec.tables
    .map((tb) => `<div class="sc-table" data-id="${e(tb.name)}" data-rough="var(--ink-blue)"><div class="sc-name" data-jitter>${t(tb.name)}</div>${tb.columns.map((c) => `<div class="sc-col" data-jitter>${t(c)}</div>`).join('')}</div>`)
    .join('');
  return `<div class="b-diagram dg-schema" data-links="${e(JSON.stringify(spec.links))}">${boxes}<svg class="sc-links"></svg></div>`;
}

function er(spec: Extract<D, { kind: 'er' }>['spec']): string {
  const cols = spec.entities.map((en) => {
    const attrs = en.attrs ?? [];
    const half = Math.ceil(attrs.length / 2);
    const oval = (a: string) => `<div class="er-attr${en.key === a ? ' er-key' : ''}" data-rough="var(--ink-orange)" data-rough-shape="pill" data-jitter>${t(a)}</div>`;
    return `<div class="er-col" data-id="${e(en.name)}"><div class="er-attrs er-top">${attrs.slice(0, half).map(oval).join('')}</div><div class="er-ent" data-rough="var(--ink-green)" data-jitter>${t(en.name)}</div><div class="er-attrs er-bot">${attrs.slice(half).map(oval).join('')}</div></div>`;
  });
  // A relation between neighbours sits as a diamond between their columns; others are lines only.
  const parts: string[] = [];
  spec.entities.forEach((en, i) => {
    parts.push(cols[i]);
    const next = spec.entities[i + 1];
    if (!next) return;
    const rel = spec.relations.find((r) => (r.from === en.name && r.to === next.name) || (r.from === next.name && r.to === en.name));
    if (rel) parts.push(`<div class="er-rel" data-from="${e(rel.from)}" data-to="${e(rel.to)}" data-rough="var(--ink-orange)" data-rough-shape="diamond" data-jitter>${t(rel.name)}</div>`);
  });
  return `<div class="b-diagram dg-er" data-relations="${e(JSON.stringify(spec.relations))}">${parts.join('')}<svg class="er-lines"></svg></div>`;
}

export function renderDiagram(b: D): string {
  switch (b.kind) {
    case 'flow': return flow(b.spec);
    case 'array': return array(b.spec);
    case 'flowchart': return flowchart(b.spec);
    case 'matrix': return matrix(b.spec);
    case 'cards': return cards(b.spec);
    case 'chain': return chain(b.spec);
    case 'tables': return tables(b.spec);
    case 'schema': return schema(b.spec);
    case 'er': return er(b.spec);
  }
}
