import { describe, expect, it } from 'vitest';
import * as edits from '@/lib/explainer/edits';
import { ExplainerDocSchema, type ExplainerDoc } from '@/lib/explainer/schema';

const doc = (): ExplainerDoc => ExplainerDocSchema.parse({
  template: 'explainer',
  theme: 'midnight',
  brand: { handle: '@stackframe', name: 'Stack Frame' },
  scene: {
    title: 'Caching',
    rows: [{ id: 'app', label: 'App' }, { id: 'db', label: 'Database', value: 200, unit: ' ms' }],
    links: [{ from: 'app', to: 'db' }],
    panel: [{ text: 'GET /user' }],
  },
  beats: [
    { id: 'b1', role: 'hook', mutations: [] },
    { id: 'b2', role: 'payoff', mutations: [{ op: 'set', row: 'db', value: 2 }] },
  ],
});

describe('document edits', () => {
  it('sets the theme without touching anything else', () => {
    const next = edits.setTheme(doc(), 'paper');
    expect(next.theme).toBe('paper');
    expect(next.scene).toEqual(doc().scene);
  });

  it('never mutates its input', () => {
    const before = doc();
    edits.setSceneText(before, 'title', 'Changed');
    expect(before.scene.title).toBe('Caching');
  });
});

describe('scene edits', () => {
  it('adds, changes and removes a row', () => {
    let d = edits.addSceneRow(doc(), {
      id: 'edge', label: 'Edge', value: null, unit: '', sub: null, state: 'idle', tier: 1, col: 0, icon: 'cache',
    });
    expect(d.scene.rows.map((r) => r.id)).toEqual(['app', 'db', 'edge']);

    d = edits.setSceneRow(d, 'edge', { value: 10, state: 'good' });
    expect(d.scene.rows[2]).toMatchObject({ value: 10, state: 'good', label: 'Edge' });

    d = edits.removeSceneRow(d, 'edge');
    expect(d.scene.rows.map((r) => r.id)).toEqual(['app', 'db']);
  });

  it('a repeated link edits the one already drawn', () => {
    const d = edits.setSceneLink(doc(), 'app', 'db', 'good', undefined);
    expect(d.scene.links).toHaveLength(1);
    expect(d.scene.links[0].state).toBe('good');
  });

  it('appends a panel line', () => {
    const d = edits.addScenePanel(doc(), 'x-cache: HIT', 'good');
    expect(d.scene.panel.map((p) => p.text)).toEqual(['GET /user', 'x-cache: HIT']);
  });
});

describe('beat edits', () => {
  it('appends a beat when no anchor is given', () => {
    const d = edits.addBeat(doc(), 'step', undefined);
    expect(d.beats.map((b) => b.role)).toEqual(['hook', 'payoff', 'step']);
  });

  it('inserts a beat behind the anchor', () => {
    const d = edits.addBeat(doc(), 'step', 'b1');
    expect(d.beats.map((b) => b.role)).toEqual(['hook', 'step', 'payoff']);
  });

  it('gives a new beat an id nothing else is using', () => {
    const d = edits.addBeat(edits.addBeat(doc(), 'step', undefined), 'step', undefined);
    expect(new Set(d.beats.map((b) => b.id)).size).toBe(d.beats.length);
  });

  it('moves, retimes and reroles a beat', () => {
    let d = edits.moveBeat(doc(), 'b2', 0);
    expect(d.beats.map((b) => b.id)).toEqual(['b2', 'b1']);
    d = edits.setBeatSec(d, 'b1', 5.5);
    expect(d.beats.find((b) => b.id === 'b1')!.sec).toBe(5.5);
    d = edits.setBeatSec(d, 'b1', null);
    expect(d.beats.find((b) => b.id === 'b1')!.sec).toBeNull();
    d = edits.setBeatRole(d, 'b1', 'step');
    expect(d.beats.find((b) => b.id === 'b1')!.role).toBe('step');
  });

  it('removes a beat', () => {
    const d = edits.removeBeat(doc(), 'b1');
    expect(d.beats.map((b) => b.id)).toEqual(['b2']);
  });
});

describe('mutation edits', () => {
  it('adds, updates, moves and removes a mutation', () => {
    let d = edits.addMutation(doc(), 'b2', { op: 'text', field: 'note', to: 'done' });
    expect(d.beats[1].mutations).toHaveLength(2);

    d = edits.updateMutation(d, 'b2', 0, { op: 'set', row: 'db', value: 5 });
    expect(d.beats[1].mutations[0]).toMatchObject({ op: 'set', value: 5 });

    d = edits.moveMutation(d, 'b2', 0, 1);
    expect(d.beats[1].mutations[0].op).toBe('text');

    d = edits.removeMutation(d, 'b2', 0);
    expect(d.beats[1].mutations.map((m) => m.op)).toEqual(['set']);
  });
});
