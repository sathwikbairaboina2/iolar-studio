import { describe, expect, it } from 'vitest';
import {
  ExplainerDocSchema, FoldError, applyBeat, foldDoc, totalSeconds, type ExplainerDoc,
} from '@/lib/explainer/schema';

const base = {
  template: 'explainer' as const,
  theme: 'midnight',
  brand: { handle: '@stackframe', name: 'Stack Frame' },
  scene: {
    title: 'Why the second request is faster',
    subtitle: 'asked twice',
    rows: [
      { id: 'app', label: 'App', tier: 0, col: 0, icon: 'server' },
      { id: 'db', label: 'Database', tier: 1, col: 0, icon: 'db', value: 200, unit: ' ms', state: 'warn' },
    ],
    links: [{ from: 'app', to: 'db' }],
    panel: [{ text: 'GET /user/42' }],
  },
  beats: [
    { id: 'b1', role: 'hook' as const, mutations: [] },
    {
      id: 'b2',
      role: 'payoff' as const,
      mutations: [
        { op: 'set' as const, row: 'db', value: 2, state: 'good' as const },
        { op: 'text' as const, field: 'note' as const, to: '200 ms becomes 2 ms' },
      ],
    },
  ],
};

const doc = (over: Partial<typeof base> = {}): ExplainerDoc =>
  ExplainerDocSchema.parse({ ...base, ...over });

describe('explainer document', () => {
  it('fills the defaults the service would', () => {
    const d = doc();
    expect(d.fps).toBe(30);
    expect(d.ratio).toBe('9:16');
    expect(d.scene.rows[0].state).toBe('idle');
    expect(d.scene.rows[0].value).toBeNull();
  });

  it('needs at least two beats', () => {
    expect(() => doc({ beats: [base.beats[0]] as never })).toThrow();
  });

  it('rejects a row state it does not know', () => {
    const bad = { ...base.scene, rows: [{ id: 'x', label: 'X', state: 'purple' }] };
    expect(() => doc({ scene: bad as never })).toThrow();
  });
});

describe('folding', () => {
  it('keeps the skeleton and changes the value in place', () => {
    const steps = foldDoc(doc());
    const db = (i: number) => steps[i].scene.rows.find((r) => r.id === 'db')!;
    expect(steps).toHaveLength(2);
    expect(db(0).value).toBe(200);
    expect(db(1).value).toBe(2);
    expect(db(1).state).toBe('good');
    // the app node is untouched and still in its slot
    expect(steps[1].scene.rows[0]).toMatchObject({ id: 'app', tier: 0, col: 0 });
  });

  it('lays beats out contiguously in frames', () => {
    const steps = foldDoc(doc());
    expect(steps[0].startFrame).toBe(0);
    expect(steps[0].durationFrames).toBe(90); // hook, 3s at 30fps
    expect(steps[1].startFrame).toBe(90);
    expect(steps[1].durationFrames).toBe(120); // payoff, 4s
    expect(totalSeconds(doc())).toBe(7);
  });

  it('names the beat when a mutation points at a row that does not exist yet', () => {
    const d = doc({
      beats: [base.beats[0], { id: 'b2', role: 'payoff', mutations: [{ op: 'set', row: 'ghost', value: 1 }] }] as never,
    });
    expect(() => foldDoc(d)).toThrow(FoldError);
    try {
      foldDoc(d);
    } catch (e) {
      expect((e as FoldError).beatId).toBe('b2');
      expect((e as FoldError).message).toContain('ghost');
    }
  });

  it('refuses to add the same row twice', () => {
    const beat = { id: 'b2', role: 'payoff' as const, sec: null, mutations: [{ op: 'add' as const, row: { id: 'app', label: 'Dup' } }] };
    expect(() => applyBeat(doc().scene, BeatOf(beat))).toThrow(/added twice/);
  });

  it('a repeated link edits the one already drawn instead of adding a second', () => {
    const d = doc({
      beats: [
        base.beats[0],
        { id: 'b2', role: 'payoff', mutations: [{ op: 'link', from: 'app', to: 'db', state: 'good' }] },
      ] as never,
    });
    const last = foldDoc(d)[1].scene;
    expect(last.links).toHaveLength(1);
    expect(last.links[0].state).toBe('good');
  });
});

// The schema fills beat defaults; tests that build a beat by hand go through it too.
function BeatOf(b: unknown) {
  return ExplainerDocSchema.parse({ ...base, beats: [base.beats[0], b] }).beats[1];
}
