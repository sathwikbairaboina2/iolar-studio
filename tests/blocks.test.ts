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

  it('tree diagram renders a root over its branches and leaves', () => {
    const h = renderBlockHtml({
      type: 'diagram', kind: 'tree',
      spec: { root: 'event loop', branches: [{ label: 'macrotask', children: ['setTimeout'] }, { label: 'microtask' }] },
    } as Block);
    expect(h).toContain('dg-tree-root');
    expect((h.match(/dg-branch/g) ?? []).length).toBe(2);
    expect(h).toContain('setTimeout');
  });

  it('compare diagram renders both sides with a vs divider', () => {
    const h = renderBlockHtml({
      type: 'diagram', kind: 'compare',
      spec: { left: { title: 'stash', items: ['one tree'] }, right: { title: 'worktree', items: ['many trees'] } },
    } as Block);
    expect((h.match(/dg-side"/g) ?? []).length).toBe(2);
    expect(h).toContain('dg-vs');
    expect(h).toContain('many trees');
  });

  it('memory-cells diagram numbers its cells and takes plain or object cells', () => {
    const h = renderBlockHtml({
      type: 'diagram', kind: 'memory-cells',
      spec: { label: 'arr', cells: ['10', { value: '20', addr: '0x2' }] },
    } as Block);
    expect((h.match(/dg-cell"/g) ?? []).length).toBe(2);
    expect(h).toContain('>0<');
    expect(h).toContain('0x2');
  });

  it('renders inline code spans instead of printing backticks', () => {
    const h = renderBlockHtml({ type: 'bullets', items: ['run `git stash` first'] } as Block);
    expect(h).toContain('<code class="b-inline">git stash</code>');
    expect(h).not.toContain('`');
  });

  it('leaves an unmatched backtick alone', () => {
    const h = renderBlockHtml({ type: 'paragraph', text: 'a lone ` tick' } as Block);
    expect(h).toContain('a lone ` tick');
  });

  it('numbers headings per page and drops numbering the author typed', () => {
    const html = renderSlideBlocks([
      { type: 'heading', text: '7. First' },
      { type: 'bullets', items: ['x'] },
      { type: 'heading', text: 'Second' },
    ] as Block[]);
    expect(html).toContain('1. First');
    expect(html).not.toContain('7. First');
    expect(html).toContain('2. Second');
  });
});
