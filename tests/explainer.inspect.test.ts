import { describe, expect, it } from 'vitest';
import { editRow, rowAt, rowsAt } from '@/lib/explainer/inspect';
import { ExplainerDocSchema, type ExplainerDoc } from '@/lib/explainer/schema';

const doc = (): ExplainerDoc => ExplainerDocSchema.parse({
  template: 'explainer',
  theme: 'midnight',
  brand: { handle: '@stackframe', name: 'Stack Frame' },
  scene: {
    title: 'Indexes',
    rows: [{ id: 'scan', label: 'Scan', value: 200, unit: ' ms' }, { id: 'index', label: 'Index', value: 200, unit: ' ms' }],
    links: [],
    panel: [],
  },
  beats: [
    { id: 'b1', role: 'hook', mutations: [] },
    { id: 'b2', role: 'step', mutations: [{ op: 'set', row: 'scan', state: 'bad' }] },
    { id: 'b3', role: 'payoff', mutations: [{ op: 'add', row: { id: 'cache', label: 'Cache' } }] },
  ],
});

describe('what a field edit should write', () => {
  it('edits the scene itself at the first beat', () => {
    expect(editRow(doc(), 'b1', 'scan', { value: 150 })).toEqual({
      op: 'scene.row.set',
      args: { rowId: 'scan', value: 150 },
    });
  });

  it('adds a change to a later beat that does not touch that row yet', () => {
    expect(editRow(doc(), 'b2', 'index', { state: 'good' })).toEqual({
      op: 'mutation.add',
      args: { beatId: 'b2', mutation: { op: 'set', row: 'index', state: 'good' } },
    });
  });

  it('updates the change a beat already makes to that row, rather than adding a second', () => {
    expect(editRow(doc(), 'b2', 'scan', { value: 400 })).toEqual({
      op: 'mutation.update',
      args: { beatId: 'b2', index: 0, mutation: { op: 'set', row: 'scan', state: 'bad', value: 400 } },
    });
  });

  it('edits the row a beat adds where it is added, not as a second change', () => {
    expect(editRow(doc(), 'b3', 'cache', { state: 'good' })).toEqual({
      op: 'mutation.update',
      args: { beatId: 'b3', index: 0, mutation: { op: 'add', row: expect.objectContaining({ id: 'cache', state: 'good' }) } },
    });
  });

  it('refuses a beat that is not on the document', () => {
    expect(editRow(doc(), 'b9', 'scan', { value: 1 })).toBeNull();
  });
});

describe('the board as it stands', () => {
  it('reads a row at the beat asked for, with the changes up to there applied', () => {
    expect(rowAt(doc(), 'b1', 'scan')?.state).toBe('idle');
    expect(rowAt(doc(), 'b2', 'scan')?.state).toBe('bad');
    expect(rowAt(doc(), 'b1', 'cache')).toBeNull();
    expect(rowAt(doc(), 'b3', 'cache')?.label).toBe('Cache');
  });

  it('lists what is on the board at a beat', () => {
    expect(rowsAt(doc(), 'b2').map((r) => r.id)).toEqual(['scan', 'index']);
    expect(rowsAt(doc(), 'b3').map((r) => r.id)).toEqual(['scan', 'index', 'cache']);
  });
});
