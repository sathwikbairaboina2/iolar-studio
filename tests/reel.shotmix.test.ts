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
  it('never gives the presenter more than fifteen seconds, however long the reel', async () => {
    const { planShotMix } = await import('@/lib/reel/shotmix');
    // Two minutes at a quarter would be thirty seconds of one man talking.
    const beats = Array.from({ length: 60 }, (_, i) =>
      beat(`b${i + 1}`, i === 0 ? 'hook' : i === 59 ? 'close' : 'body', 2)
    );

    const plan = planShotMix(beats, {});

    const face = plan.filter((p) => p.kind === 'talking-head').reduce((s, p) => s + p.seconds, 0);
    expect(face).toBeLessThanOrEqual(15);
    expect(face).toBeGreaterThan(0);
  });

  it('spends the face on the hook first', async () => {
    const { planShotMix } = await import('@/lib/reel/shotmix');
    const beats = [beat('b1', 'hook', 4), ...Array.from({ length: 8 }, (_, i) => beat(`b${i + 2}`, 'body', 4)), beat('b10', 'close', 4)];

    // Forty seconds at a quarter is ten, and a bite has to run five: there is room for one
    // here, and the opening is where a face buys the most.
    const plan = planShotMix(beats, {});
    expect(plan.find((p) => p.beatId === 'b1')!.kind).toBe('talking-head');
  });

  it('keeps the close as well once there is budget for two bites', async () => {
    const { planShotMix } = await import('@/lib/reel/shotmix');
    const beats = [beat('b1', 'hook', 4), ...Array.from({ length: 8 }, (_, i) => beat(`b${i + 2}`, 'body', 4)), beat('b10', 'close', 4)];

    const plan = planShotMix(beats, { presenterMaxSec: 20 });
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

    const plan = planShotMix(beats, {});
    // A page shot needs a page. Without one the only honest picture is the person saying it.
    expect(plan.find((p) => p.beatId === 'b2')!.kind).toBe('talking-head');
  });

  it('renders neighbouring presenter lines as one bite, not several', async () => {
    const { planShotMix, presenterBites } = await import('@/lib/reel/shotmix');
    const beats = [beat('b1', 'hook', 3), beat('b2', 'body', 3), beat('b3', 'body', 3), beat('b4', 'close', 3)];

    const plan = planShotMix(beats, { presenterMaxSec: 20 });
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
    const plan = planShotMix(beats, { presenterMaxSec: 1 });
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

    const out = applyShotMix(lines, beats, spans, {});

    const heads = out.filter((b) => b.shot.kind === 'talking-head');
    expect(heads.length).toBeGreaterThan(0);
    // Ten four-second beats is forty seconds; a quarter of that is ten, so two or three
    // lines get a face and the rest get their source on screen.
    expect(heads.length).toBeLessThanOrEqual(3);
    expect(out.filter((b) => b.shot.kind === 'screen').length).toBeGreaterThanOrEqual(7);
  });

  it('opens on a face even when the hook beat is a title card', async () => {
    const { applyShotMix } = await import('@/lib/reel/build/bridge');
    const lines = Array.from({ length: 8 }, (_, i) => line(`l${i + 1}`, true));
    const beats = lines.map((l, i) => asBeat(`b${i + 1}`, i === 0 ? 'hook' : i === 7 ? 'close' : 'body', l.id));
    beats[0].shot.kind = 'title';
    const spans = new Map(beats.map((b) => [b.id, { start: 0, end: 3 }]));

    const out = applyShotMix(lines, beats, spans, {});
    // The title is an overlay, so the first spoken line is the opening as far as the face is
    // concerned. Otherwise the reel meets the person only as it ends.
    expect(out.find((b) => b.id === 'b2')!.shot.kind).toBe('talking-head');
  });

  it('still gives an uncited line the presenter', async () => {
    const { applyShotMix } = await import('@/lib/reel/build/bridge');
    const lines = [line('l1', true), line('l2', false), line('l3', true), line('l4', true)];
    const beats = [asBeat('b1', 'hook', 'l1'), asBeat('b2', 'body', 'l2'), asBeat('b3', 'body', 'l3'), asBeat('b4', 'close', 'l4')];
    const spans = new Map(beats.map((b) => [b.id, { start: 0, end: 3 }]));

    const out = applyShotMix(lines, beats, spans, {});
    expect(out.find((b) => b.id === 'b2')!.shot.kind).toBe('talking-head');
  });
});

describe('a presenter bite is worth rendering', () => {
  const beat = (beatId: string, role: 'hook' | 'body' | 'close', seconds: number, cites = true) => ({
    beatId, role, seconds, cites,
  });

  it('never asks for a bite shorter than five seconds', async () => {
    const { planShotMix, presenterBites } = await import('@/lib/reel/shotmix');
    // Beats cut to speech run one to two seconds. Rendered alone that is what came back as
    // half a second of a face restarting, which is the worst thing in the reel.
    const beats = Array.from({ length: 30 }, (_, i) =>
      beat(`b${i + 1}`, i === 0 ? 'hook' : i === 29 ? 'close' : 'body', 1.5)
    );

    const plan = planShotMix(beats, { minBiteSec: 5 });

    for (const bite of presenterBites(plan)) {
      expect(bite.seconds).toBeGreaterThanOrEqual(5);
    }
  });

  it('grows a bite around a line that has nothing to show', async () => {
    const { planShotMix, presenterBites } = await import('@/lib/reel/shotmix');
    const beats = [
      beat('b1', 'hook', 2),
      beat('b2', 'body', 2),
      beat('b3', 'body', 2, false),
      beat('b4', 'body', 2),
      beat('b5', 'body', 2),
      beat('b6', 'close', 2),
    ];

    const plan = planShotMix(beats, { presenterMaxSec: 20, minBiteSec: 5 });
    const bites = presenterBites(plan);

    // b3 cannot be a page shot, so the bite that carries it takes its neighbours until it is
    // long enough to be worth rendering.
    const carrying = bites.find((b) => b.beatIds.includes('b3'))!;
    expect(carrying.seconds).toBeGreaterThanOrEqual(5);
  });

  it('never ends a bite before its sentence completes', async () => {
    const { planShotMix, presenterBites } = await import('@/lib/reel/shotmix');
    // b1..b3 are one sentence split across three beats; the hook anchor sits on b1.
    // Growing to five seconds alone would stop at b2 or b3's edge mid-thought.
    const beats = [
      { ...beat('b1', 'hook', 2), endsSentence: false },
      { ...beat('b2', 'body', 2), endsSentence: false },
      { ...beat('b3', 'body', 2), endsSentence: true },
      { ...beat('b4', 'body', 2), endsSentence: true },
      { ...beat('b5', 'close', 2), endsSentence: true },
    ];

    const plan = planShotMix(beats, { minBiteSec: 5 });
    const bites = presenterBites(plan);
    const byId = new Map(plan.map((p) => [p.beatId, p]));

    for (const bite of bites) {
      const last = byId.get(bite.beatIds[bite.beatIds.length - 1])!;
      expect(last.endsSentence).toBe(true);
    }
  });

  it('opens a bite where a sentence opens', async () => {
    const { planShotMix, presenterBites } = await import('@/lib/reel/shotmix');
    // The close anchor lands on b5, but b4 left its sentence hanging: a bite starting at b5
    // would open on the back half of a thought.
    const beats = [
      { ...beat('b1', 'hook', 6), endsSentence: true },
      { ...beat('b2', 'body', 4), endsSentence: true },
      { ...beat('b3', 'body', 4), endsSentence: true },
      { ...beat('b4', 'body', 3), endsSentence: false },
      { ...beat('b5', 'close', 5), endsSentence: true },
    ];

    const plan = planShotMix(beats, { minBiteSec: 5 });
    const bites = presenterBites(plan);
    const index = new Map(beats.map((b, i) => [b.beatId, i]));

    for (const bite of bites) {
      const first = index.get(bite.beatIds[0])!;
      if (first > 0) expect(beats[first - 1].endsSentence).toBe(true);
    }
  });

  it('treats a beat without the flag as ending its sentence', async () => {
    const { planShotMix, presenterBites } = await import('@/lib/reel/shotmix');
    const beats = Array.from({ length: 10 }, (_, i) =>
      beat(`b${i + 1}`, i === 0 ? 'hook' : i === 9 ? 'close' : 'body', 2)
    );

    // No endsSentence anywhere: the plan must match what it always produced.
    const bites = presenterBites(planShotMix(beats, { minBiteSec: 5 }));
    expect(bites.length).toBeGreaterThanOrEqual(1);
    for (const bite of bites) expect(bite.seconds).toBeGreaterThanOrEqual(5);
  });

  it('spends the budget on fewer, longer bites rather than many stubs', async () => {
    const { planShotMix, presenterBites } = await import('@/lib/reel/shotmix');
    const beats = Array.from({ length: 40 }, (_, i) =>
      beat(`b${i + 1}`, i === 0 ? 'hook' : i === 39 ? 'close' : 'body', 1.7)
    );

    const bites = presenterBites(planShotMix(beats, { minBiteSec: 5 }));
    expect(bites.length).toBeLessThanOrEqual(3);
    expect(bites.length).toBeGreaterThanOrEqual(1);
  });
});

describe('collapsing neighbours into one request', () => {
  const seg = (beatId: string, key: string, seconds: number) => ({ beatId, key, seconds });

  it('takes the start of a group from the reel clock when it is given one', async () => {
    const { groupAdjacent } = await import('@/lib/reel/shotmix');
    const groups = groupAdjacent([
      { beatId: 'b1', key: 'presenter', seconds: 2, startsAt: 2.56 },
      { beatId: 'b2', key: 'presenter', seconds: 2, startsAt: 4.6 },
      { beatId: 'b3', key: 'page:x', seconds: 3, startsAt: 6.7 },
    ]);
    // Summed durations put the closing bite at the top of the voiceover: it was rendered
    // against the wrong words, and two groups wrote to the same audio file.
    expect(groups[0].startsAt).toBeCloseTo(2.56, 2);
    expect(groups[1].startsAt).toBeCloseTo(6.7, 2);
  });

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

  it('measures a group by the clock, not by adding its beats up', async () => {
    const { groupAdjacent } = await import('@/lib/reel/shotmix');
    const groups = groupAdjacent([
      { beatId: 'b1', key: 'presenter', seconds: 1.2, startsAt: 55.78 },
      { beatId: 'b2', key: 'presenter', seconds: 1.4, startsAt: 57.6 },
      { beatId: 'b3', key: 'presenter', seconds: 1.5, startsAt: 65.34 },
    ]);

    // Beats do not butt together — there is breath between them. Adding the three durations
    // gave 4.1s for a stretch that runs eleven on the clock, so the recording came back two
    // seconds short of the words it was meant to cover and froze at the end.
    expect(groups).toHaveLength(1);
    expect(groups[0].seconds).toBeCloseTo(11.06, 2);
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
