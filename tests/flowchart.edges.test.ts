import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { renderDiagram } from '@/lib/renderer/diagrams';
import type { Block } from '@/lib/schema';

describe('drawFlowchartEdges', () => {
  it('draws one path per edge and a label text where given', () => {
    const src = readFileSync(path.join(process.cwd(), 'templates', '_shared', 'diagrams.js'), 'utf8');
    new Function(src)();
    document.body.innerHTML = renderDiagram({ type: 'diagram', kind: 'flowchart', spec: {
      rows: [['a'], ['b', 'c']],
      nodes: { a: { text: 'A', shape: 'box' }, b: { text: 'B', shape: 'box' }, c: { text: 'C', shape: 'diamond' } },
      edges: [{ from: 'a', to: 'b', label: 'yes' }, { from: 'a', to: 'c' }],
    } } as Extract<Block, { type: 'diagram' }>);
    (window as unknown as { drawFlowchartEdges: (r: Document) => void }).drawFlowchartEdges(document);
    const svg = document.querySelector('svg.fc-edges')!;
    expect(svg.querySelectorAll(':scope > path').length).toBe(2);
    expect(svg.querySelectorAll('text.fc-label').length).toBe(1);
    expect(svg.querySelector('text.fc-label')!.textContent).toBe('yes');
  });
});

describe('schema and er overlays', () => {
  const load = () => {
    const src = readFileSync(path.join(process.cwd(), 'templates', '_shared', 'diagrams.js'), 'utf8');
    new Function(src)();
    return window as unknown as { drawSchemaLinks: (r: Document) => void; drawErLines: (r: Document) => void; drawDiagramOverlays: (r: Document) => void };
  };
  it('schema: one path per link, labels at the ends', () => {
    const w = load();
    document.body.innerHTML = renderDiagram({ type: 'diagram', kind: 'schema', spec: { tables: [{ name: 'A', columns: ['id'] }, { name: 'B', columns: ['a_id'] }, { name: 'C', columns: ['b_id'] }], links: [{ from: 'A', to: 'B', fromLabel: '1', toLabel: 'N', arrow: true }, { from: 'B', to: 'C' }] } } as Extract<Block, { type: 'diagram' }>);
    w.drawSchemaLinks(document);
    const svg = document.querySelector('svg.sc-links')!;
    expect(svg.querySelectorAll(':scope > path').length).toBe(2);
    expect(svg.querySelectorAll('text.sc-label').length).toBe(2);
  });
  it('er: one line per attribute plus two per neighbouring relation', () => {
    const w = load();
    document.body.innerHTML = renderDiagram({ type: 'diagram', kind: 'er', spec: { entities: [{ name: 'S', attrs: ['a', 'b', 'c'] }, { name: 'C', attrs: ['x'] }], relations: [{ from: 'S', to: 'C', name: 'r', labels: ['M', 'N'] }] } } as Extract<Block, { type: 'diagram' }>);
    w.drawErLines(document);
    const svg = document.querySelector('svg.er-lines')!;
    expect(svg.querySelectorAll(':scope > path').length).toBe(6);
    expect(svg.querySelectorAll('text').length).toBe(2);
  });
  it('drawDiagramOverlays runs all three without throwing on an empty page', () => {
    const w = load();
    document.body.innerHTML = '';
    expect(() => w.drawDiagramOverlays(document)).not.toThrow();
  });
});
