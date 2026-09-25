import { describe, it, expect } from 'vitest';
import { renderDiagram } from '@/lib/renderer/diagrams';
import type { Block } from '@/lib/schema';

type D = Extract<Block, { type: 'diagram' }>;

describe('flow wrapping', () => {
  it('pairs every arrow with the node it points at so a wrapped row cannot end in an arrow', () => {
    const html = renderDiagram({ type: 'diagram', kind: 'flow', spec: { nodes: ['a', 'b', 'c'] } } as never);
    expect(html.match(/dg-link/g)?.length).toBe(2);
    expect(html).not.toMatch(/<\/span><span class="dg-arrow">→<\/span><span class="dg-node"/);
    expect(html.indexOf('dg-arrow')).toBeLessThan(html.indexOf('>b<'));
  });
});

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

describe('set 2/3 diagram kinds', () => {
  it('chain: title, boxes with notes, arrows between', () => {
    const h = renderDiagram({ type: 'diagram', kind: 'chain', spec: { title: 'Key hierarchy', steps: [{ text: 'Super Key', note: 'any set' }, { text: 'Candidate Key', note: 'minimal', ink: 'orange' }] } } as D);
    expect(h).toContain('dg-chain');
    expect(h).toContain('ch-title');
    expect((h.match(/ch-box/g) ?? []).length).toBe(2);
    expect((h.match(/ch-arrow/g) ?? []).length).toBe(1);
    expect(h).toContain('var(--ink-orange)');
  });
  it('tables: side-by-side tables with captions and an arrow', () => {
    const h = renderDiagram({ type: 'diagram', kind: 'tables', spec: { arrow: true, tables: [{ title: 'Before', headers: ['a'], rows: [['1']], caption: 'not 1NF' }, { title: 'After', headers: ['a', 'b'], rows: [['1', '2']] }] } } as D);
    expect(h).toContain('dg-tables');
    expect((h.match(/class="tb"/g) ?? []).length).toBe(2);
    expect(h).toContain('tb-arrow');
    expect(h).toContain('not 1NF');
  });
  it('schema: table boxes and a link list for the browser', () => {
    const h = renderDiagram({ type: 'diagram', kind: 'schema', spec: { tables: [{ name: 'DEPARTMENT', columns: ['ID (PK)', 'Dept_Name'] }, { name: 'STUDENT', columns: ['Roll_No (PK)', 'Dept_ID (FK)'] }], links: [{ from: 'DEPARTMENT', to: 'STUDENT', fromLabel: '1', toLabel: 'N', arrow: true }] } } as D);
    expect(h).toContain('dg-schema');
    expect((h.match(/sc-table/g) ?? []).length).toBe(2);
    expect(h).toContain('data-id="DEPARTMENT"');
    expect(h).toContain('sc-links');
    expect(h).toContain('&quot;fromLabel&quot;:&quot;1&quot;');
  });
  it('er: entities with attribute ovals, key underlined, a diamond between neighbours', () => {
    const h = renderDiagram({ type: 'diagram', kind: 'er', spec: { entities: [{ name: 'STUDENT', attrs: ['Roll_No', 'Name', 'Email'], key: 'Roll_No' }, { name: 'COURSE', attrs: ['Course_ID', 'Title'], key: 'Course_ID' }], relations: [{ from: 'STUDENT', to: 'COURSE', name: 'ENROLLS', labels: ['M', 'N'] }] } } as D);
    expect(h).toContain('dg-er');
    expect((h.match(/er-ent"/g) ?? []).length).toBe(2);
    expect((h.match(/er-attr /g) ?? []).length + (h.match(/er-attr"/g) ?? []).length).toBe(5);
    expect(h).toContain('er-key');
    expect(h).toContain('er-rel');
    expect(h).toContain('data-rough-shape="diamond"');
    expect(h).toContain('er-lines');
  });
  it('flowchart: title box, icon nodes and icons inside boxes', () => {
    const h = renderDiagram({ type: 'diagram', kind: 'flowchart', spec: { title: 'RDS Architecture', rows: [['app', 'rds'], ['r1']], nodes: { app: { text: 'Application', shape: 'icon', icon: 'laptop' }, rds: { text: 'RDS', shape: 'box', icon: 'rds' }, r1: { text: 'Read Replica', shape: 'icon', icon: 'database' } }, edges: [{ from: 'app', to: 'rds' }, { from: 'rds', to: 'r1' }] } } as D);
    expect(h).toContain('dg-titled');
    expect(h).toContain('fc-title');
    expect((h.match(/fc-icon/g) ?? []).length).toBe(2);
    expect(h).toContain('fc-node-icon');
    expect(h.toLowerCase()).toContain('#c925d1'.toLowerCase().slice(0, 1));
  });
  it('cards: icon, text, code and chain bodies, up to six', () => {
    const h = renderDiagram({ type: 'diagram', kind: 'cards', spec: { cards: [
      { title: 'Users', icon: 'user', text: 'An individual identity' },
      { title: 'DDL', code: ['CREATE TABLE Student (', '  id INT', ');'] },
      { title: '2-Tier', chain: ['Client', 'Database Server'] },
      { title: 'Roles', icon: 'ec2', lines: ['assume'] },
      { title: 'E', lines: ['x'] }, { title: 'F', lines: ['y'] },
    ] } } as D);
    expect(h).toContain('--card-cols:6');
    expect(h).toContain('card-icon');
    expect(h).toContain('card-text');
    expect(h).toContain('card-code');
    expect((h.match(/cc-box/g) ?? []).length).toBe(2);
    expect(h).toContain('cc-arrow');
    expect(h).toContain('ic-aws');
  });
});

describe('layerFlowchart', () => {
  const node = (text: string) => ({ text, shape: 'box' as const });
  const decision = {
    rows: [['n0'], ['b0', 'b1', 'b2'], ['c0'], ['c1'], ['c2']],
    nodes: { n0: node('failure?'), b0: node('expected'), b1: node('impossible'), b2: node('in a goroutine'), c0: node('return error'), c1: node('panic'), c2: node('own recover') },
    edges: [{ from: 'n0', to: 'b0' }, { from: 'n0', to: 'b1' }, { from: 'n0', to: 'b2' }, { from: 'b0', to: 'c0' }, { from: 'b1', to: 'c1' }, { from: 'b2', to: 'c2' }],
  };

  it('puts each outcome under its own branch, so no line crosses a node', async () => {
    const { layerFlowchart } = await import('@/lib/renderer/diagrams');
    expect(layerFlowchart(decision)).toEqual([['n0'], ['b0', 'b1', 'b2'], ['c0', 'c1', 'c2']]);
  });

  it('orders a row by where its parents sit', async () => {
    const { layerFlowchart } = await import('@/lib/renderer/diagrams');
    const crossed = { ...decision, rows: [['n0'], ['b0', 'b1', 'b2'], ['c2'], ['c0'], ['c1']] };
    expect(layerFlowchart(crossed)).toEqual([['n0'], ['b0', 'b1', 'b2'], ['c0', 'c1', 'c2']]);
  });

  it('leaves a layout with sideways or backward lines exactly as written', async () => {
    const { layerFlowchart } = await import('@/lib/renderer/diagrams');
    const loop = { ...decision, edges: [...decision.edges, { from: 'c1', to: 'n0' }] };
    expect(layerFlowchart(loop)).toEqual(decision.rows);
    const sideways = { ...decision, edges: [...decision.edges, { from: 'b0', to: 'b1' }] };
    expect(layerFlowchart(sideways)).toEqual(decision.rows);
  });

  it('leaves a layout whose lines already step one row at a time', async () => {
    const { layerFlowchart } = await import('@/lib/renderer/diagrams');
    const chain = { rows: [['a'], ['b'], ['c']], nodes: { a: node('a'), b: node('b'), c: node('c') }, edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }] };
    expect(layerFlowchart(chain)).toEqual(chain.rows);
  });
});
