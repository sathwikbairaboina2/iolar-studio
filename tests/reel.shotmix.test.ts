import { describe, it, expect } from 'vitest';

/**
 * Who is on screen, and for how long.
 *
 * A talking head for the whole runtime is the thing that made these reels unwatchable. The
 * reference this is measured against gives the presenter about a quarter of the time — the
 * hook, a couple of turns in the argument, the close — and spends the rest on what is being
 * talked about. The planner decides which lines are worth a face; it is not obliged to keep
 * them adjacent, and a run that happens to be adjacent is rendered as one bite rather than
 * several.
 */

const beat = (beatId: string, role: 'hook' | 'body' | 'close', seconds: number) => ({
  beatId,
  role,
  seconds,
  cites: true,
});

describe('planning who is on screen', () => {
  it('keeps the presenter to about a quarter of the runtime', async () => {
    const { planShotMix } = await import('@/lib/reel/shotmix');
    const beats = Array.from({ length: 12 }, (_, i) =>
      beat(`b${i + 1}`, i === 0 ? 'hook' : i === 11 ? 'close' : 'body', 5)
    );

    const plan = planShotMix(beats, { presenterShare: 0.25 });

    const presenterSec = plan.filter((p) => p.kind === 'talking-head').reduce((s, p) => s + p.seconds, 0);
    expect(presenterSec).toBeGreaterThan(0);
    expect(presenterSec / 60).toBeLessThanOrEqual(0.3);
  });

  it('spends the face where it earns its place — the hook and the close', async () => {
    const { planShotMix } = await import('@/lib/reel/shotmix');
    const beats = [beat('b1', 'hook', 4), ...Array.from({ length: 8 }, (_, i) => beat(`b${i + 2}`, 'body', 4)), beat('b10', 'close', 4)];

    const plan = planShotMix(beats, { presenterShare: 0.25 });

    expect(plan.find((p) => p.beatId === 'b1')!.kind).toBe('talking-head');
    expect(plan.find((p) => p.beatId === 'b10')!.kind).toBe('talking-head');
  });

  it('gives a beat with nothing to show the presenter rather than a blank page', async () => {
    const { planShotMix } = await import('@/lib/reel/shotmix');
    const beats = [
      beat('b1', 'hook', 3),
      { ...beat('b2', 'body', 3), cites: false },
      beat('b3', 'body', 3),
      beat('b4', 'close', 3),
    ];

    const plan = planShotMix(beats, { presenterShare: 0.25 });
    // A page shot needs a page. Without one the only honest picture is the person saying it.
    expect(plan.find((p) => p.beatId === 'b2')!.kind).toBe('talking-head');
  });

  it('renders neighbouring presenter lines as one bite, not several', async () => {
    const { planShotMix, presenterBites } = await import('@/lib/reel/shotmix');
    const beats = [beat('b1', 'hook', 3), beat('b2', 'body', 3), beat('b3', 'body', 3), beat('b4', 'close', 3)];

    const plan = planShotMix(beats, { presenterShare: 0.5 });
    const bites = presenterBites(plan);

    for (const bite of bites) {
      expect(bite.beatIds.length).toBeGreaterThan(0);
      expect(bite.seconds).toBeCloseTo(
        bite.beatIds.reduce((s, id) => s + plan.find((p) => p.beatId === id)!.seconds, 0),
        3
      );
    }
    // Adjacent lines share a bite: a cut between two generations of the same photo is where
    // the pose resets and the hands teleport.
    const adjacent = plan.filter((p) => p.kind === 'talking-head').map((p) => p.beatId);
    if (adjacent.includes('b1') && adjacent.includes('b2')) {
      expect(bites.find((b) => b.beatIds.includes('b1'))!.beatIds).toContain('b2');
    }
  });

  it('never leaves the reel without a face', async () => {
    const { planShotMix } = await import('@/lib/reel/shotmix');
    const beats = Array.from({ length: 30 }, (_, i) => beat(`b${i + 1}`, 'body', 2));
    const plan = planShotMix(beats, { presenterShare: 0.05 });
    expect(plan.some((p) => p.kind === 'talking-head')).toBe(true);
  });
});

describe('the mix reaches the beats', () => {
  const line = (id: string, cites: boolean) => ({ id, citations: cites ? ['c1'] : [] });
  const asBeat = (id: string, role: 'hook' | 'body' | 'close', lineId: string) => ({
    id,
    role,
    text: `${id} says a sentence about the thing`,
    shot: { kind: 'screen' as string, brief: '', hero: false, alsoAssetIds: [], sourceLineId: lineId },
  });

  it('caps the face even when every line has a page behind it', async () => {
    const { applyShotMix } = await import('@/lib/reel/build/bridge');
    const lines = Array.from({ length: 10 }, (_, i) => line(`l${i + 1}`, true));
    const beats = lines.map((l, i) =>
      asBeat(`b${i + 1}`, i === 0 ? 'hook' : i === 9 ? 'close' : 'body', l.id)
    );
    const spans = new Map(beats.map((b) => [b.id, { start: 0, end: 4 }]));

    const out = applyShotMix(lines, beats, spans, { presenterShare: 0.25 });

    const heads = out.filter((b) => b.shot.kind === 'talking-head');
    expect(heads.length).toBeGreaterThan(0);
    // Ten four-second beats is forty seconds; a quarter of that is ten, so two or three
    // lines get a face and the rest get their source on screen.
    expect(heads.length).toBeLessThanOrEqual(3);
    expect(out.filter((b) => b.shot.kind === 'screen').length).toBeGreaterThanOrEqual(7);
  });

  it('still gives an uncited line the presenter', async () => {
    const { applyShotMix } = await import('@/lib/reel/build/bridge');
    const lines = [line('l1', true), line('l2', false), line('l3', true), line('l4', true)];
    const beats = [asBeat('b1', 'hook', 'l1'), asBeat('b2', 'body', 'l2'), asBeat('b3', 'body', 'l3'), asBeat('b4', 'close', 'l4')];
    const spans = new Map(beats.map((b) => [b.id, { start: 0, end: 3 }]));

    const out = applyShotMix(lines, beats, spans, { presenterShare: 0.25 });
    expect(out.find((b) => b.id === 'b2')!.shot.kind).toBe('talking-head');
  });
});

describe('collapsing neighbours into one request', () => {
  const seg = (beatId: string, key: string, seconds: number) => ({ beatId, key, seconds });

  it('visits a source once, however many lines are spoken over it', async () => {
    const { groupAdjacent } = await import('@/lib/reel/shotmix');
    const groups = groupAdjacent([
      seg('b3', 'page:einstein', 1.8),
      seg('b4', 'page:einstein', 1.5),
      seg('b5', 'page:minkowski', 2.5),
      seg('b6', 'page:minkowski', 1.6),
      seg('b7', 'page:minkowski', 2.6),
      seg('b8', 'presenter', 1.5),
    ]);

    // Recording the same page four times with slightly different framing is four renders
    // and four cuts that read as a stutter on one document.
    expect(groups.map((g) => g.key)).toEqual(['page:einstein', 'page:minkowski', 'presenter']);
    expect(groups[1].beatIds).toEqual(['b5', 'b6', 'b7']);
    expect(groups[1].seconds).toBeCloseTo(6.7, 3);
    expect(groups[1].startsAt).toBeCloseTo(3.3, 3);
  });

  it('keeps the same source apart when something else comes between', async () => {
    const { groupAdjacent } = await import('@/lib/reel/shotmix');
    const groups = groupAdjacent([
      seg('b1', 'page:arxiv', 2),
      seg('b2', 'presenter', 2),
      seg('b3', 'page:arxiv', 2),
    ]);
    // Cutting away and back is a return to the page, not a continuation of it.
    expect(groups).toHaveLength(3);
    expect(groups[2].startsAt).toBeCloseTo(4, 3);
  });
});
