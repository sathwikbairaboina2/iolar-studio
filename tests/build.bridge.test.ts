import { describe, it, expect } from 'vitest';
import { attachSourceLines, coerceKinds, orderedLines, scriptText, RESEARCHED_KINDS } from '@/lib/reel/build/bridge';

/**
 * The bridge's whole job is provenance: a beat has to know which line it came
 * from, because a `screen` beat is rendered by visiting that line's citation.
 */

const line = (id: string, text: string) => ({ id, text });
const beat = (id: string, text: string) => ({
  id,
  text,
  shot: { kind: 'screen' as const, brief: '', hero: false, alsoAssetIds: [], sourceLineId: null },
});

describe('scriptText', () => {
  it('is the approved lines in order and nothing else', () => {
    expect(scriptText({ lines: [line('l1', 'One. '), line('l2', ' Two.')] as never })).toBe('One. Two.');
  });
});

describe('attachSourceLines', () => {
  it('points a beat at the line it was cut from', () => {
    const lines = [line('l1', 'Rust landed in six point one.'), line('l2', 'The first driver came in six point eight.')];
    const beats = [beat('b1', 'Rust landed in six point one.'), beat('b2', 'The first driver came in six point eight.')];

    const out = attachSourceLines(lines, beats);
    expect(out.map((b) => b.shot.sourceLineId)).toEqual(['l1', 'l2']);
  });

  // The planner splits on shot length, not on sentence, so one line routinely
  // becomes two beats. Both are still that line's claim, and both cite it.
  it('gives every piece of a split line the same source', () => {
    const lines = [line('l1', 'Rust landed in six point one, released December eleventh.')];
    const beats = [beat('b1', 'Rust landed in six point one,'), beat('b2', 'released December eleventh.')];

    expect(attachSourceLines(lines, beats).map((b) => b.shot.sourceLineId)).toEqual(['l1', 'l1']);
  });

  // A beat that runs across a boundary opens with the earlier line's claim.
  it('assigns a straddling beat to the line it starts in', () => {
    const lines = [line('l1', 'One two.'), line('l2', 'Three four.')];
    const beats = [beat('b1', 'One two. Three'), beat('b2', 'four.')];

    expect(attachSourceLines(lines, beats)[0].shot.sourceLineId).toBe('l1');
  });

  it('is insensitive to the whitespace the planner returns', () => {
    const lines = [line('l1', 'One  two.'), line('l2', 'Three four.')];
    const beats = [beat('b1', 'One two.'), beat('b2', 'Three   four.')];

    expect(attachSourceLines(lines, beats).map((b) => b.shot.sourceLineId)).toEqual(['l1', 'l2']);
  });

  it('leaves the rest of the shot alone', () => {
    const [out] = attachSourceLines([line('l1', 'One.')], [beat('b1', 'One.')]);
    expect(out.shot.kind).toBe('screen');
    expect(out.shot.alsoAssetIds).toEqual([]);
  });
});

describe('RESEARCHED_KINDS', () => {
  // Neither plugin makes generic b-roll, so a beat asking for it would strand.
  it('excludes broll, so every beat has a renderer', () => {
    expect(RESEARCHED_KINDS).not.toContain('broll');
    expect(RESEARCHED_KINDS).toEqual(['title', 'talking-head', 'screen']);
  });
});

describe('coerceKinds', () => {
  const cited = [{ id: 'l1', citations: ['c1'] }, { id: 'l2', citations: [] }];
  const b = (id: string, kind: string, sourceLineId: string | null) => ({
    id,
    shot: { kind, brief: '', hero: false, alsoAssetIds: [], sourceLineId },
  });

  // The palette is in the prompt, and the first live run ignored it for three
  // beats out of fourteen. A prompt is a request, not a guarantee.
  it('turns a stray broll beat into a page visit when its line cites something', () => {
    const [out] = coerceKinds(cited as never, [b('b1', 'broll', 'l1')] as never);
    expect(out.shot.kind).toBe('screen');
  });

  it('turns a stray broll beat into the presenter when there is nothing to show', () => {
    const [out] = coerceKinds(cited as never, [b('b1', 'broll', 'l2')] as never);
    expect(out.shot.kind).toBe('talking-head');
  });

  it('leaves the kinds a renderer already owns alone', () => {
    const out = coerceKinds(cited as never, [b('b1', 'screen', 'l1'), b('b2', 'title', null), b('b3', 'talking-head', 'l2')] as never);
    expect(out.map((o) => o.shot.kind)).toEqual(['screen', 'title', 'talking-head']);
  });
});

describe('line order', () => {
  // order comes from the model and is only re-derived from array position on a
  // drop or reorder. If the two disagree, sorting by position builds the script
  // backwards and every beat cites the wrong line.
  it('builds the script from line.order, not array position', () => {
    const lines = [
      { id: 'l2', order: 2, text: 'Second.' },
      { id: 'l1', order: 1, text: 'First.' },
    ];
    expect(scriptText({ lines } as never)).toBe('First. Second.');
  });

  it('attaches sources in spoken order too', () => {
    const lines = orderedLines([
      { id: 'l2', order: 2, text: 'Second.', citations: [] },
      { id: 'l1', order: 1, text: 'First.', citations: [] },
    ] as never);
    const beats = [
      { id: 'b1', text: 'First.', shot: { kind: 'screen', brief: '', hero: false, alsoAssetIds: [], sourceLineId: null } },
      { id: 'b2', text: 'Second.', shot: { kind: 'screen', brief: '', hero: false, alsoAssetIds: [], sourceLineId: null } },
    ];
    expect(attachSourceLines(lines as never, beats as never).map((b) => b.shot.sourceLineId)).toEqual(['l1', 'l2']);
  });
});

describe('coerceKinds with a pack', () => {
  // A citation can point at a candidate dropped in review. Promoting that beat to
  // a page visit strands it; the presenter can always say the line.
  it('does not send a beat to a page whose source was dropped in review', () => {
    const lines = [{ id: 'l1', citations: ['gone'] }];
    const beats = [{ id: 'b1', shot: { kind: 'broll', brief: '', hero: false, alsoAssetIds: [], sourceLineId: 'l1' } }];
    const [out] = coerceKinds(lines as never, beats as never, new Set(['still-here']));
    expect(out.shot.kind).toBe('talking-head');
  });

  it('still sends it to the page when the source survived', () => {
    const lines = [{ id: 'l1', citations: ['c1'] }];
    const beats = [{ id: 'b1', shot: { kind: 'broll', brief: '', hero: false, alsoAssetIds: [], sourceLineId: 'l1' } }];
    const [out] = coerceKinds(lines as never, beats as never, new Set(['c1']));
    expect(out.shot.kind).toBe('screen');
  });
});
