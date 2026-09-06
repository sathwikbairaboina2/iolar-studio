import { describe, it, expect } from 'vitest';
import { validatePost, MAX_SLIDES } from '@/lib/schema';

const minimal = {
  brand: 'iolar', template: 'spiral-notes', ratio: '3:4', seed: 42,
  series: 'TEST SERIES', date: '29/08/2026',
  slides: [{ page_title: 'Page 1', blocks: [{ type: 'heading', text: 'Hi' }] }],
  caption: { text: 'c', hashtags: ['#x'] },
};

describe('PostSchema', () => {
  it('accepts a minimal valid post', () => {
    expect(validatePost(minimal).slides.length).toBe(1);
  });
  it('rejects unknown block type', () => {
    const bad = structuredClone(minimal);
    (bad.slides[0].blocks[0] as { type: string }).type = 'nope';
    expect(() => validatePost(bad)).toThrow();
  });
  it('accepts more than MAX_SLIDES slides (the cap is advisory)', () => {
    const many = structuredClone(minimal);
    many.slides = Array.from({ length: MAX_SLIDES + 2 }, (_, i) => ({
      page_title: `P${i}`, blocks: [{ type: 'heading', text: 'x' }],
    }));
    expect(validatePost(many).slides.length).toBe(MAX_SLIDES + 2);
  });
  it('rejects bad ratio', () => {
    expect(() => validatePost({ ...minimal, ratio: '9:16' })).toThrow();
  });
});

describe('block additions', () => {
  const withBlock = (block: unknown) => ({
    ...minimal, slides: [{ page_title: 'P', blocks: [block] }],
  });

  it('accepts list styles, frames and inks on bullets', () => {
    const p = validatePost(withBlock({ type: 'bullets', items: ['a'], style: 'number', frame: 'dashed', ink: 'purple' }));
    const b = p.slides[0].blocks[0];
    expect(b).toMatchObject({ style: 'number', frame: 'dashed', ink: 'purple' });
  });

  it('accepts pink ink and the checkbox and star styles', () => {
    validatePost(withBlock({ type: 'bullets', items: ['a'], style: 'checkbox', ink: 'pink' }));
    validatePost(withBlock({ type: 'bullets', items: ['a'], style: 'star' }));
  });

  it('rejects an unknown list style', () => {
    expect(() => validatePost(withBlock({ type: 'bullets', items: ['a'], style: 'squiggle' }))).toThrow();
  });

  it('accepts frame and ink on paragraph, highlightRow on table, note on code', () => {
    validatePost(withBlock({ type: 'paragraph', text: 'x', frame: 'solid', ink: 'orange' }));
    validatePost(withBlock({ type: 'table', headers: ['a'], rows: [['1']], highlightRow: 0, frame: 'dashed' }));
    validatePost(withBlock({ type: 'code', lang: 'java', lines: ['int x;'], note: 'sorted only' }));
  });

  it('rejects a negative highlightRow', () => {
    expect(() => validatePost(withBlock({ type: 'table', headers: ['a'], rows: [['1']], highlightRow: -1 }))).toThrow();
  });

  it('accepts sticky callouts', () => {
    validatePost(withBlock({ type: 'callout', style: 'sticky', title: 'T', text: 't' }));
    validatePost(withBlock({ type: 'callout', style: 'sticky-pink', title: 'T', text: 't' }));
  });

  it('accepts every diagram kind with its spec', () => {
    validatePost(withBlock({ type: 'diagram', kind: 'flow', spec: { nodes: ['a', { text: 'b', sub: 's', ink: 'green' }] } }));
    validatePost(withBlock({ type: 'diagram', kind: 'array', spec: { cells: ['2', '5'], pointers: [{ index: 0, label: 'low' }], highlight: [1], dim: [], caption: 'c' } }));
    validatePost(withBlock({ type: 'diagram', kind: 'flowchart', spec: {
      rows: [['s'], ['d'], ['l', 'r']],
      nodes: { s: { text: 'Start' }, d: { text: 'ok?', shape: 'diamond' }, l: { text: 'L' }, r: { text: 'R', ink: 'red' } },
      edges: [{ from: 's', to: 'd' }, { from: 'd', to: 'l', label: 'yes' }, { from: 'd', to: 'r', label: 'no' }],
    } }));
    validatePost(withBlock({ type: 'diagram', kind: 'matrix', spec: { rows: [['1', '2'], ['3', '4']], highlight: [[0, 1]] } }));
    validatePost(withBlock({ type: 'diagram', kind: 'cards', spec: { cards: [{ title: 'A', lines: ['x'] }, { title: 'B', lines: ['y'], ink: 'blue' }] } }));
  });

  it('accepts the set 2/3 diagram kinds and card bodies', () => {
    validatePost(withBlock({ type: 'diagram', kind: 'chain', spec: { steps: [{ text: 'a', note: 'n' }] } }));
    validatePost(withBlock({ type: 'diagram', kind: 'tables', spec: { tables: [{ headers: ['a'], rows: [['1']] }], arrow: true } }));
    validatePost(withBlock({ type: 'diagram', kind: 'schema', spec: { tables: [{ name: 'A', columns: ['id'] }, { name: 'B', columns: ['a_id'] }], links: [{ from: 'A', to: 'B', fromLabel: '1', toLabel: 'N' }] } }));
    validatePost(withBlock({ type: 'diagram', kind: 'er', spec: { entities: [{ name: 'S', attrs: ['id'], key: 'id' }, { name: 'C', attrs: [] }], relations: [{ from: 'S', to: 'C', name: 'takes', labels: ['M', 'N'] }] } }));
    validatePost(withBlock({ type: 'diagram', kind: 'flowchart', spec: { title: 't', rows: [['a']], nodes: { a: { text: 'A', shape: 'icon', icon: 'ec2' } }, edges: [] } }));
    validatePost(withBlock({ type: 'diagram', kind: 'cards', spec: { cards: [{ title: 'a', icon: 'user', text: 't' }, { title: 'b', code: ['x'] }, { title: 'c', chain: ['1', '2'] }, { title: 'd' }, { title: 'e' }, { title: 'f' }] } }));
  });

  it('rejects schema links and er relations that name unknown tables', () => {
    expect(() => validatePost(withBlock({ type: 'diagram', kind: 'schema', spec: { tables: [{ name: 'A', columns: ['id'] }], links: [{ from: 'A', to: 'Z' }] } }))).toThrow();
    expect(() => validatePost(withBlock({ type: 'diagram', kind: 'er', spec: { entities: [{ name: 'S' }], relations: [{ from: 'S', to: 'Z', name: 'r' }] } }))).toThrow();
    expect(() => validatePost(withBlock({ type: 'diagram', kind: 'cards', spec: { cards: Array.from({ length: 7 }, (_, i) => ({ title: String(i) })) } }))).toThrow();
  });

  it('rejects removed diagram kinds and wrong specs', () => {
    expect(() => validatePost(withBlock({ type: 'diagram', kind: 'memory-cells', spec: {} }))).toThrow();
    expect(() => validatePost(withBlock({ type: 'diagram', kind: 'array', spec: { nodes: ['a'] } }))).toThrow();
    expect(() => validatePost(withBlock({ type: 'diagram', kind: 'cards', spec: { cards: [{ title: 'only one', lines: ['x'] }] } }))).toThrow();
    expect(() => validatePost(withBlock({ type: 'diagram', kind: 'flowchart', spec: { rows: [['a']], nodes: { a: { text: 'a' } }, edges: [{ from: 'a', to: 'zzz' }] } }))).toThrow();
  });

  it('accepts study-sheet as a template', () => {
    validatePost({ ...minimal, template: 'study-sheet' });
  });

  it('still validates every stored post', async () => {
    const { readdirSync, readFileSync, existsSync } = await import('fs');
    const path = await import('path');
    const root = path.join(process.cwd(), 'data', 'handbooks');
    if (!existsSync(root)) return;
    for (const subject of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const sdir = path.join(root, subject.name);
      for (const chapter of readdirSync(sdir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
        const parts = path.join(sdir, chapter.name, 'parts');
        if (!existsSync(parts)) continue;
        for (const part of readdirSync(parts)) {
          const f = path.join(parts, part, 'post.json');
          if (existsSync(f)) expect(() => validatePost(JSON.parse(readFileSync(f, 'utf8')))).not.toThrow();
        }
      }
    }
  });
});
