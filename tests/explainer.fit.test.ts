import { describe, expect, it } from 'vitest';
import { fit } from '@/lib/explainer/fit';
import { diff } from '@/lib/explainer/diff';
import { ExplainerDocSchema, type ExplainerDoc } from '@/lib/explainer/schema';

const doc = (over: Partial<ExplainerDoc> = {}): ExplainerDoc => ExplainerDocSchema.parse({
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
    { id: 'b1', role: 'hook', mutations: [{ op: 'text', field: 'note', to: 'Same query.' }] },
    { id: 'b2', role: 'step', mutations: [{ op: 'set', row: 'scan', state: 'bad' }] },
    { id: 'b3', role: 'payoff', mutations: [{ op: 'set', row: 'index', value: 2, state: 'good' }] },
  ],
  ...over,
});

const levels = (d: ExplainerDoc, seconds?: number) => fit(d, seconds).notes.map((n) => n.level);
const said = (d: ExplainerDoc, seconds?: number) => fit(d, seconds).notes.map((n) => n.text).join(' | ');

describe('the fit report', () => {
  it('says nothing is wrong with a document that is fine', () => {
    const report = fit(doc(), 9);
    expect(report.seconds).toBe(9);
    expect(report.notes.filter((n) => n.level !== 'good')).toEqual([]);
  });

  it('calls a document far over its target bad, and one a little over a warning', () => {
    const long = doc({ beats: [...doc().beats, { id: 'b4', role: 'step', sec: 30, mutations: [{ op: 'panel', text: 'x', state: 'idle' }] }] as ExplainerDoc['beats'] });
    expect(levels(long, 16)).toContain('bad');
    expect(said(long, 16)).toMatch(/39s against a target of 16s/);

    const slightly = doc({ beats: [...doc().beats, { id: 'b4', role: 'step', sec: 2, mutations: [{ op: 'panel', text: 'x', state: 'idle' }] }] as ExplainerDoc['beats'] });
    expect(fit(slightly, 9).notes.some((n) => n.level === 'warn' && /target/.test(n.text))).toBe(true);
  });

  it('names a beat that changes nothing, because a still frame is not a beat', () => {
    const still = doc({ beats: [{ id: 'b1', role: 'hook', mutations: [] }, ...doc().beats.slice(1)] as ExplainerDoc['beats'] });
    expect(said(still)).toMatch(/b1 changes nothing/);
  });

  it('names a row nothing ever touches', () => {
    const spare = doc({
      scene: { ...doc().scene, rows: [...doc().scene.rows, { id: 'spare', label: 'Spare', value: null, unit: '', sub: null, state: 'idle', tier: 0, col: 0, icon: 'none' }] },
    });
    expect(said(spare)).toMatch(/"spare" never changes/);
  });

  it('wants a hook first and a payoff somewhere', () => {
    const shapeless = doc({ beats: [
      { id: 'b1', role: 'step', mutations: [{ op: 'set', row: 'scan', state: 'bad' }] },
      { id: 'b2', role: 'step', mutations: [{ op: 'set', row: 'index', state: 'good' }] },
    ] as ExplainerDoc['beats'] });
    expect(said(shapeless)).toMatch(/hook/);
    expect(said(shapeless)).toMatch(/payoff/);
  });

  it('counts the busiest board, and complains when it is too crowded', () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({ id: `r${i}`, label: `Row ${i}` }));
    const crowded = ExplainerDocSchema.parse({
      ...doc(),
      scene: { ...doc().scene, rows },
      beats: [
        { id: 'b1', role: 'hook', mutations: [{ op: 'set', row: 'r0', state: 'good' }] },
        { id: 'b2', role: 'payoff', mutations: [{ op: 'set', row: 'r1', state: 'good' }] },
      ],
    });
    const report = fit(crowded);
    expect(report.busiestBoard).toBe(9);
    expect(report.notes.some((n) => n.level !== 'good' && /rows on the board/.test(n.text))).toBe(true);
  });
});

describe('the diff', () => {
  it('says nothing about two documents that are the same', () => {
    expect(diff(doc(), doc())).toEqual([]);
  });

  it('reads a theme change, a new row, a dropped beat and a busier beat', () => {
    const before = doc();
    const after = ExplainerDocSchema.parse({
      ...before,
      theme: 'paper',
      scene: { ...before.scene, rows: [...before.scene.rows, { id: 'cache', label: 'Cache' }] },
      beats: [
        before.beats[0],
        { ...before.beats[1], mutations: [...before.beats[1].mutations, { op: 'panel', text: 'x-cache: HIT' }] },
      ],
    });
    const lines = diff(before, after).join(' | ');
    expect(lines).toMatch(/theme midnight -> paper/);
    expect(lines).toMatch(/\+ row "cache"/);
    expect(lines).toMatch(/- beat b3/);
    expect(lines).toMatch(/b2: 1 change -> 2/);
  });

  it('reads a retitle and a removed row', () => {
    const before = doc();
    const after = ExplainerDocSchema.parse({
      ...before,
      scene: { ...before.scene, title: 'Why indexes win', rows: before.scene.rows.slice(0, 1) },
    });
    const lines = diff(before, after).join(' | ');
    expect(lines).toMatch(/title "Indexes" -> "Why indexes win"/);
    expect(lines).toMatch(/- row "index"/);
  });
});
