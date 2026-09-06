import { describe, it, expect } from 'vitest';
import { renderBlockHtml, renderSlideBlocks } from '@/lib/renderer/blocks';
import type { Block } from '@/lib/schema';
import { forcesFullWidth, collectWarnings } from '@/lib/renderer/blocks';

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
      { type: 'diagram', kind: 'flow', spec: { nodes: ['a', 'b', 'c', 'd'] } },
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
    expect(h).toContain('x = <span class="tk-num">1</span>');
  });

  it('flow diagram renders nodes with arrows', () => {
    const h = renderBlockHtml({
      type: 'diagram', kind: 'flow', spec: { nodes: ['a', 'b', 'c'] },
    } as Block);
    expect(h).toContain('dg-node');
    expect((h.match(/dg-arrow/g) ?? []).length).toBe(2);
  });
});

describe('list styles and frames', () => {
  it('numbered lists use circled digits', () => {
    const h = renderBlockHtml({ type: 'bullets', items: ['a', 'b'], style: 'number' } as Block);
    expect(h).toContain('bl-number');
    expect(h).toContain('①');
    expect(h).toContain('②');
  });
  it('check and cross lists carry their glyph class', () => {
    expect(renderBlockHtml({ type: 'bullets', items: ['a'], style: 'check' } as Block)).toContain('bl-check');
    expect(renderBlockHtml({ type: 'bullets', items: ['a'], style: 'cross' } as Block)).toContain('bl-cross');
  });
  it('a framed block is wrapped in a rough frame with its ink and dash flag', () => {
    const h = renderBlockHtml({ type: 'bullets', items: ['a'], frame: 'dashed', ink: 'purple' } as Block);
    expect(h).toMatch(/<div class="b-frame" data-rough="var\(--ink-purple\)" data-rough-dash="1">/);
    const solid = renderBlockHtml({ type: 'paragraph', text: 'p', frame: 'solid' } as Block);
    expect(solid).toContain('data-rough="var(--ink-blue)"');
    expect(solid).not.toContain('data-rough-dash');
  });
  it('manifest defaults apply only when the block leaves frame unset', () => {
    const d = { defaults: { frame: 'dashed' as const } };
    expect(renderBlockHtml({ type: 'bullets', items: ['a'] } as Block, d)).toContain('b-frame');
    expect(renderBlockHtml({ type: 'bullets', items: ['a'], frame: 'none' } as Block, d)).not.toContain('b-frame');
    expect(renderBlockHtml({ type: 'heading', text: 'h' } as Block, d)).not.toContain('b-frame');
    expect(renderBlockHtml({ type: 'code', lang: 'py', lines: ['x'] } as Block, d)).not.toContain('b-frame');
    expect(renderBlockHtml({ type: 'table', headers: ['a'], rows: [['1']] } as Block, d)).not.toContain('b-frame');
    expect(renderBlockHtml({ type: 'table', headers: ['a'], rows: [['1']], frame: 'solid' } as Block, d)).toContain('b-frame');
  });
  it('bullet items carry inline markup', () => {
    expect(renderBlockHtml({ type: 'bullets', items: ['==a=='] } as Block)).toContain('<mark class="hl">a</mark>');
  });
});

describe('tables', () => {
  it('highlights the requested row', () => {
    const h = renderBlockHtml({ type: 'table', headers: ['a'], rows: [['1'], ['2']], highlightRow: 1 } as Block);
    expect(h).toContain('<tr class="hl-row"><td data-jitter>2</td></tr>');
    expect(h).not.toContain('<tr class="hl-row"><td data-jitter>1</td>');
  });
});

describe('sticky callouts', () => {
  it('render as a note with a pin and no rough frame', () => {
    const h = renderBlockHtml({ type: 'callout', style: 'sticky', title: 'T', text: 'x' } as Block);
    expect(h).toContain('co-sticky');
    expect(h).not.toContain('data-rough');
    expect(h).toContain('co-pin');
    expect(renderBlockHtml({ type: 'callout', style: 'sticky-pink', title: 'T', text: 'x' } as Block)).toContain('co-sticky-pink');
  });
});

describe('code rules', () => {
  const code = (lines: string[], extra = {}) => ({ type: 'code', lang: 'python', lines, ...extra }) as Block;
  it('colours tokens and keeps jitter off', () => {
    const h = renderBlockHtml(code(['if x: # c']));
    expect(h).toContain('tk-kw');
    expect(h).toContain('tk-cm');
    expect(h).not.toContain('data-jitter');
  });
  it('renders the note as a sticky inside the box', () => {
    const h = renderBlockHtml(code(['x'], { note: 'sorted ==only==' }));
    expect(h).toContain('code-note');
    expect(h).toContain('<mark class="hl">only</mark>');
    expect(h).toContain('has-note');
  });
  it('forces full width past 34 chars and steps down past 60', () => {
    expect(forcesFullWidth(code(['a'.repeat(34)]))).toBe(false);
    expect(forcesFullWidth(code(['a'.repeat(35)]))).toBe(true);
    expect(renderBlockHtml(code(['a'.repeat(61)]))).toContain('code-small');
    expect(renderBlockHtml(code(['a'.repeat(60)]))).not.toContain('code-small');
  });
  it('a note does not widen the block', () => {
    expect(forcesFullWidth(code(['a'.repeat(30)], { note: 'n' }))).toBe(false);
  });
  it('truncates past 80 chars and reports a warning', () => {
    const long = 'b'.repeat(90);
    const h = renderBlockHtml(code([long]));
    expect(h).toContain('b'.repeat(80) + '…');
    expect(h).not.toContain(long);
    expect(collectWarnings([code([long]), code(['ok'])])).toEqual(['block 0: code line 1 truncated at 80 chars']);
  });
});

describe('forcesFullWidth for diagrams', () => {
  const dg = (kind: string, spec: unknown) => ({ type: 'diagram', kind, spec }) as Block;
  it('cards always; array past 10 cells; flowchart never; flow from 4 nodes; matrix past 4 columns', () => {
    expect(forcesFullWidth(dg('array', { cells: ['1'], indices: true, pointers: [], highlight: [], dim: [] }))).toBe(false);
    expect(forcesFullWidth(dg('array', { cells: Array.from({ length: 11 }, (_, i) => String(i)), indices: true, pointers: [], highlight: [], dim: [] }))).toBe(true);
    expect(forcesFullWidth(dg('flowchart', { rows: [['a'], ['b']], nodes: { a: { text: 'a', shape: 'box' }, b: { text: 'b', shape: 'box' } }, edges: [] }))).toBe(false);
    expect(forcesFullWidth(dg('cards', { cards: [{ title: 'a', lines: ['x'] }, { title: 'b', lines: ['y'] }] }))).toBe(true);
    expect(forcesFullWidth(dg('flow', { nodes: ['a', 'b', 'c'] }))).toBe(false);
    expect(forcesFullWidth(dg('flow', { nodes: ['a', 'b', 'c', 'd'] }))).toBe(true);
    expect(forcesFullWidth(dg('matrix', { rows: [['1', '2', '3', '4']], highlight: [] }))).toBe(false);
    expect(forcesFullWidth(dg('matrix', { rows: [['1', '2', '3', '4', '5']], highlight: [] }))).toBe(true);
  });
});

describe('title-duplicate heading', () => {
  it('hides a first heading that repeats the page title, keeping its index', () => {
    const h = renderSlideBlocks([{ type: 'heading', text: '1. Binary Search Fundamentals' }, { type: 'paragraph', text: 'p' }] as Block[], { pageTitle: 'Binary Search Fundamentals' });
    expect(h).toContain('class="pk-unit pk-hidden" data-block-index="0"');
    expect(h).toContain('data-block-index="1"');
  });
  it('keeps a first heading that says something else, and any later heading', () => {
    expect(renderSlideBlocks([{ type: 'heading', text: '1. What is it?' }] as Block[], { pageTitle: 'Binary Search Fundamentals' })).not.toContain('pk-hidden');
    expect(renderSlideBlocks([{ type: 'paragraph', text: 'p' }, { type: 'heading', text: 'Binary Search Fundamentals' }] as Block[], { pageTitle: 'Binary Search Fundamentals' })).not.toContain('pk-hidden');
  });
});
