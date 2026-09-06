import { describe, it, expect } from 'vitest';
import { renderDiagram } from '@/lib/renderer/diagrams';
import type { Block } from '@/lib/schema';

type D = Extract<Block, { type: 'diagram' }>;

describe('renderDiagram', () => {
  it('flow: string and object nodes, arrows between', () => {
    const h = renderDiagram({ type: 'diagram', kind: 'flow', spec: { nodes: ['a', { text: 'b', sub: 'why', ink: 'green' }] } } as D);
    expect(h).toContain('dg-flow');
    expect((h.match(/class="dg-node/g) ?? []).length).toBe(2);
    expect((h.match(/dg-arrow/g) ?? []).length).toBe(1);
    expect(h).toContain('dg-sub');
    expect(h).toContain('var(--ink-green)');
  });

  it('array: indices, cells, highlight, dim, pointers and caption', () => {
    const h = renderDiagram({ type: 'diagram', kind: 'array', spec: {
      cells: ['2', '5', '8'], indices: true, pointers: [{ index: 0, label: 'low' }, { index: 2, label: 'high', ink: 'red' }], highlight: [1], dim: [2], caption: 'found',
    } } as D);
    expect(h).toContain('dg-array');
    expect((h.match(/class="ar-idx"/g) ?? []).length).toBe(3);
    expect((h.match(/ar-cell/g) ?? []).length).toBe(3);
    expect(h).toContain('ar-cell ar-hl');
    expect(h).toContain('ar-cell ar-dim');
    expect(h).toContain('low');
    expect(h).toContain('var(--ink-red)');
    expect(h).toContain('ar-caption');
    expect(h).toContain('--ar-cols:3');
  });

  it('array: no index row when indices is false', () => {
    const h = renderDiagram({ type: 'diagram', kind: 'array', spec: { cells: ['1'], indices: false, pointers: [], highlight: [], dim: [] } } as D);
    expect(h).not.toContain('ar-idx');
  });

  it('flowchart: rows, shaped nodes and an edge list for the browser', () => {
    const h = renderDiagram({ type: 'diagram', kind: 'flowchart', spec: {
      rows: [['s'], ['d'], ['l', 'r']],
      nodes: { s: { text: 'Start', shape: 'pill' }, d: { text: 'ok?', shape: 'diamond' }, l: { text: 'L', shape: 'box' }, r: { text: 'R', shape: 'box', ink: 'red' } },
      edges: [{ from: 's', to: 'd' }, { from: 'd', to: 'l', label: 'yes' }, { from: 'd', to: 'r', label: 'no' }],
    } } as D);
    expect(h).toContain('dg-flowchart');
    expect((h.match(/fc-row/g) ?? []).length).toBe(3);
    expect(h).toContain('data-id="d"');
    expect(h).toContain('data-rough-shape="diamond"');
    expect(h).toContain('data-rough-shape="pill"');
    expect(h).toContain('fc-edges');
    expect(h).toContain('data-edges="');
    expect(h).toContain('&quot;label&quot;:&quot;yes&quot;');
  });

  it('matrix: cells and highlight', () => {
    const h = renderDiagram({ type: 'diagram', kind: 'matrix', spec: { rows: [['1', '2'], ['3', '4']], highlight: [[1, 0]], caption: 'n=2' } } as D);
    expect(h).toContain('dg-matrix');
    expect((h.match(/<td/g) ?? []).length).toBe(4);
    expect(h).toContain('class="mx-hl"');
    expect(h).toContain('n=2');
  });

  it('cards: one box per card with title and lines', () => {
    const h = renderDiagram({ type: 'diagram', kind: 'cards', spec: { cards: [{ title: 'A', lines: ['x', 'y'] }, { title: 'B', lines: ['z'], ink: 'purple' }] } } as D);
    expect(h).toContain('dg-cards');
    expect((h.match(/class="card"/g) ?? []).length).toBe(2);
    expect(h).toContain('--card-cols:2');
    expect(h).toContain('var(--ink-purple)');
  });

  it('applies inline markup to labels and escapes html', () => {
    const h = renderDiagram({ type: 'diagram', kind: 'flow', spec: { nodes: ['==hot== <b>'] } } as D);
    expect(h).toContain('<mark class="hl">hot</mark>');
    expect(h).toContain('&lt;b&gt;');
  });
});
