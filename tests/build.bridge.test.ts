import { describe, it, expect } from 'vitest';
import { attachSourceLines, scriptText, RESEARCHED_KINDS } from '@/lib/reel/build/bridge';

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
