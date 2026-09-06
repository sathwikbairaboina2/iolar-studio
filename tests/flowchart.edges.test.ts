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
