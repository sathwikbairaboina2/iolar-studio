import { describe, it, expect } from 'vitest';
import { renderBlockHtml, renderSlideBlocks } from '@/lib/renderer/blocks';
import type { Block } from '@/lib/schema';

describe('renderSlideBlocks', () => {
  it('wraps every block with index and type', () => {
    const html = renderSlideBlocks([
      { type: 'heading', text: 'H' },
      { type: 'paragraph', text: 'P' },
    ] as Block[]);
    expect(html).toContain('data-block-index="0"');
    expect(html).toContain('data-block-type="heading"');
    expect(html).toContain('data-block-index="1"');
    expect((html.match(/class="pk-unit"/g) ?? []).length).toBe(2);
  });

  it('marks wide tables and diagrams as force-full', () => {
    const wide = renderSlideBlocks([
      { type: 'table', headers: ['a', 'b', 'c', 'd'], rows: [['1', '2', '3', '4']] },
    ] as Block[]);
    expect(wide).toContain('data-force-full="1"');

    const narrow = renderSlideBlocks([
      { type: 'table', headers: ['a', 'b'], rows: [['1', '2']] },
    ] as Block[]);
    expect(narrow).not.toContain('data-force-full="1"');

    const diagram = renderSlideBlocks([
      { type: 'diagram', kind: 'flow', spec: { nodes: ['a'] } },
    ] as Block[]);
    expect(diagram).toContain('data-force-full="1"');
  });
});

describe('renderBlockHtml', () => {
  it('escapes HTML in text', () => {
    const h = renderBlockHtml({ type: 'heading', text: '<script>x' } as Block);
    expect(h).not.toContain('<script>');
    expect(h).toContain('&lt;script&gt;');
  });

  it('renders table with all cells', () => {
    const h = renderBlockHtml({ type: 'table', headers: ['A', 'B'], rows: [['1', '2'], ['3', '4']] } as Block);
    for (const c of ['A', 'B', '1', '2', '3', '4']) expect(h).toContain(c);
    expect(h).toContain('b-table');
  });

  it('renders code without jitter (code must stay legible)', () => {
    const h = renderBlockHtml({ type: 'code', lang: 'python', lines: ['print(1)'] } as Block);
    expect(h).toContain('b-code');
    expect(h).not.toContain('data-jitter');
  });

  it('sidebox carries rough frame with ink color', () => {
    const h = renderBlockHtml({ type: 'sidebox', title: 'T', items: ['x'], ink: 'green' } as Block);
    expect(h).toContain('data-rough');
  });

  it('qa renders question, label, bullets and code', () => {
    const h = renderBlockHtml({
      type: 'qa', q: 'What?', a_bullets: ['because'], example_code: ['x = 1'],
    } as Block);
    expect(h).toContain('What?');
    expect(h).toContain('Ans');
    expect(h).toContain('because');
    expect(h).toContain('x = 1');
  });

  it('flow diagram renders nodes with arrows', () => {
    const h = renderBlockHtml({
      type: 'diagram', kind: 'flow', spec: { nodes: ['a', 'b', 'c'] },
    } as Block);
    expect(h).toContain('dg-node');
    expect((h.match(/dg-arrow/g) ?? []).length).toBe(2);
  });

  it('non-flow diagram renders staged box', () => {
    const h = renderBlockHtml({ type: 'diagram', kind: 'tree', spec: { root: 'x' } } as Block);
    expect(h).toContain('b-diagram-staged');
  });
});
