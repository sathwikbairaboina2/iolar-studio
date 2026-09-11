import { describe, expect, it } from 'vitest';
import { COMMANDS, CommandError, applyOne } from '@/lib/explainer/commands';
import { ExplainerDocSchema, type ExplainerDoc } from '@/lib/explainer/schema';

const doc = (): ExplainerDoc => ExplainerDocSchema.parse({
  template: 'explainer',
  theme: 'midnight',
  brand: { handle: '@stackframe', name: 'Stack Frame' },
  scene: {
    title: 'Caching',
    rows: [{ id: 'app', label: 'App' }, { id: 'db', label: 'Database', value: 200, unit: ' ms' }],
    links: [],
    panel: [],
  },
  beats: [
    { id: 'b1', role: 'hook', mutations: [] },
    { id: 'b2', role: 'payoff', mutations: [{ op: 'set', row: 'db', value: 2 }] },
  ],
});

const run = (d: ExplainerDoc, op: string, args: unknown) => applyOne(d, { op, args, actor: 'ui' });

describe('the registry', () => {
  it('applies a command and summarises it', () => {
    const out = run(doc(), 'doc.theme', { theme: 'paper' });
    expect(out.doc.theme).toBe('paper');
    expect(out.summary).toContain('paper');
  });

  it('rejects an unknown op and says which ops exist', () => {
    try {
      run(doc(), 'doc.explode', {});
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as CommandError;
      expect(err.status).toBe(400);
      expect(err.detail.validOps).toContain('doc.theme');
    }
  });

  it('rejects a bad argument and hands back the schema', () => {
    try {
      run(doc(), 'beat.sec', { beatId: 'b1', sec: 'soon' });
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as CommandError;
      expect(err.status).toBe(400);
      expect(err.detail.schema).toBeDefined();
    }
  });

  it('rejects a beat id that is not on the document, listing the ones that are', () => {
    try {
      run(doc(), 'beat.sec', { beatId: 'b9', sec: 2 });
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as CommandError;
      expect(err.status).toBe(404);
      expect(err.detail.validIds).toEqual(['b1', 'b2']);
    }
  });

  it('does not write the addressing id onto the row it addresses', () => {
    const out = run(doc(), 'scene.row.set', { rowId: 'db', value: 7 });
    const row = out.doc.scene.rows.find((r) => r.id === 'db')!;
    expect(row.value).toBe(7);
    expect((row as Record<string, unknown>).rowId).toBeUndefined();
  });

  it('every command in the registry names an edit that exists', async () => {
    const edits = await import('@/lib/explainer/edits');
    for (const [name, spec] of Object.entries(COMMANDS)) {
      expect(typeof (edits as Record<string, unknown>)[spec.fn], `${name} -> ${spec.fn}`).toBe('function');
    }
  });
});

describe('the fold post-condition', () => {
  it('refuses a move that strips a dependency, naming the beat', () => {
    const d = run(
      run(doc(), 'mutation.add', {
        beatId: 'b1',
        mutation: { op: 'add', row: { id: 'edge', label: 'Edge' } },
      }).doc,
      'mutation.add',
      { beatId: 'b2', mutation: { op: 'set', row: 'edge', state: 'good' } }
    ).doc;

    try {
      run(d, 'beat.move', { beatId: 'b2', toIndex: 0 });
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as CommandError;
      expect(err.status).toBe(422);
      expect(err.detail.beatId).toBe('b2');
      expect(err.message).toContain('edge');
    }
  });

  it('refuses a document that is no longer valid', () => {
    try {
      run(doc(), 'doc.replace', { doc: { template: 'explainer', theme: 'midnight' } });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as CommandError).status).toBe(400);
    }
  });
});

describe('row references are beat-relative', () => {
  /** `edge` is added at b2, so it exists at b3 and does not exist at b1. */
  const growing = (): ExplainerDoc => ExplainerDocSchema.parse({
    template: 'explainer',
    theme: 'midnight',
    brand: { handle: '@stackframe', name: 'Stack Frame' },
    scene: { title: 'Growing board', rows: [{ id: 'origin', label: 'Origin' }], links: [], panel: [] },
    beats: [
      { id: 'b1', role: 'hook', mutations: [] },
      { id: 'b2', role: 'step', mutations: [{ op: 'add', row: { id: 'edge', label: 'Edge' } }] },
      { id: 'b3', role: 'payoff', mutations: [] },
    ],
  });

  it('accepts a row that exists by the target beat', () => {
    const out = run(growing(), 'mutation.add', {
      beatId: 'b3',
      mutation: { op: 'set', row: 'edge', state: 'good' },
    });
    expect(out.doc.beats[2].mutations).toHaveLength(1);
  });

  it('rejects the same row at an earlier beat, listing what is on the board there', () => {
    try {
      run(growing(), 'mutation.add', { beatId: 'b1', mutation: { op: 'set', row: 'edge', state: 'good' } });
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as CommandError;
      expect(err.status).toBe(404);
      expect(err.detail.validIds).toEqual(['origin']);
      expect(err.detail.beatId).toBe('b1');
    }
  });

  it('checks both ends of a link', () => {
    try {
      run(growing(), 'mutation.add', { beatId: 'b1', mutation: { op: 'link', from: 'origin', to: 'edge' } });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as CommandError).detail.validIds).toEqual(['origin']);
    }
  });

  it('sees rows the same beat added before this mutation', () => {
    const d = run(growing(), 'mutation.add', {
      beatId: 'b1',
      mutation: { op: 'add', row: { id: 'cache', label: 'Cache' } },
    }).doc;
    const out = run(d, 'mutation.add', { beatId: 'b1', mutation: { op: 'set', row: 'cache', state: 'good' } });
    expect(out.doc.beats[0].mutations).toHaveLength(2);
  });

  it('lets `*` through, since it names no row in particular', () => {
    const out = run(growing(), 'mutation.add', { beatId: 'b1', mutation: { op: 'set', row: '*', state: 'good' } });
    expect(out.doc.beats[0].mutations).toHaveLength(1);
  });
});
