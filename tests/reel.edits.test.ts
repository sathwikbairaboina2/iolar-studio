import { describe, it, expect } from 'vitest';

const clip = (id: string, start: number, end: number, over = {}) => ({
  id,
  assetId: 'a1',
  start,
  end,
  srcIn: 0,
  fit: 'cover' as const,
  motion: { type: 'zoom-in' as const, strength: 0.12, origin: [0.5, 0.5] as [number, number] },
  transition: 'cut' as const,
  locked: false,
  ...over,
});

async function base() {
  const { validateReel } = await import('@/lib/reel/schema');
  return validateReel({
    pattern: 'armand',
    title: 'Grok',
    beats: [{ id: 'b1', role: 'hook', text: 'x', shot: { kind: 'broll', brief: '' } }],
    assets: [{ id: 'a1', kind: 'video', path: 'assets/a1.mp4', origin: 'comfy', status: 'ready' }],
    timeline: {
      clips: [clip('c1', 0, 3), clip('c2', 3, 6), clip('c3', 6, 9)],
      captions: [
        { id: 'k1', text: 'just launched', start: 0.5, end: 1.4 },
        { id: 'k2', text: 'basically an', start: 1.4, end: 2.2 },
      ],
      overlays: [],
    },
  });
}

const contiguous = (clips: { start: number; end: number }[]) =>
  clips.every((c, i) => i === 0 || Math.abs(c.start - clips[i - 1].end) < 1e-6);

describe('clip edits', () => {
  it('trimming the out edge shortens the clip and pulls the rest back', async () => {
    const { trimClip } = await import('@/lib/reel/edits');
    const out = trimClip(await base(), 'c2', 'out', -1);
    expect(out.timeline.clips[1].end - out.timeline.clips[1].start).toBeCloseTo(2, 3);
    expect(contiguous(out.timeline.clips)).toBe(true);
    expect(out.timeline.clips[1].locked).toBe(true);
    expect(out.timeline.clips[2].locked).toBe(false);
  });

  it('trimming the in edge advances the source, never below the minimum length', async () => {
    const { trimClip } = await import('@/lib/reel/edits');
    const out = trimClip(await base(), 'c1', 'in', 1);
    expect(out.timeline.clips[0].srcIn).toBeCloseTo(1, 3);
    const tiny = trimClip(await base(), 'c1', 'in', 99);
    expect(tiny.timeline.clips[0].end - tiny.timeline.clips[0].start).toBeGreaterThanOrEqual(0.2);
  });

  it('splitting at the playhead makes two clips that meet, with the source carried over', async () => {
    const { splitClip } = await import('@/lib/reel/edits');
    const out = splitClip(await base(), 'c1', 1.2);
    expect(out.timeline.clips).toHaveLength(4);
    expect(out.timeline.clips[0].end).toBeCloseTo(1.2, 3);
    expect(out.timeline.clips[1].start).toBeCloseTo(1.2, 3);
    expect(out.timeline.clips[1].srcIn).toBeCloseTo(1.2, 3);
    expect(out.timeline.clips[0].locked && out.timeline.clips[1].locked).toBe(true);
  });

  it('refuses a split too close to an edge', async () => {
    const { splitClip } = await import('@/lib/reel/edits');
    const reel = await base();
    expect(splitClip(reel, 'c1', 0.05)).toEqual(reel);
    expect(splitClip(reel, 'c1', 2.99)).toEqual(reel);
  });

  it('deleting closes the hole', async () => {
    const { deleteClip } = await import('@/lib/reel/edits');
    const out = deleteClip(await base(), 'c2');
    expect(out.timeline.clips.map((c) => c.id)).toEqual(['c1', 'c3']);
    expect(contiguous(out.timeline.clips)).toBe(true);
    expect(out.timeline.clips[1].start).toBeCloseTo(3, 3);
  });

  it('reordering keeps each clip its own length', async () => {
    const { moveClip } = await import('@/lib/reel/edits');
    const out = moveClip(await base(), 'c3', 0);
    expect(out.timeline.clips.map((c) => c.id)).toEqual(['c3', 'c1', 'c2']);
    expect(contiguous(out.timeline.clips)).toBe(true);
    for (const c of out.timeline.clips) expect(c.end - c.start).toBeCloseTo(3, 3);
  });

  it('motion, fit, transition and asset swaps all lock the clip', async () => {
    const edits = await import('@/lib/reel/edits');
    const reel = await base();
    expect(edits.setClipMotion(reel, 'c1', { type: 'hold' }).timeline.clips[0]).toMatchObject({
      motion: { type: 'hold' },
      locked: true,
    });
    expect(edits.setClipFit(reel, 'c1', 'contain').timeline.clips[0]).toMatchObject({ fit: 'contain', locked: true });
    expect(edits.setClipTransition(reel, 'c1', 'crossfade').timeline.clips[0]).toMatchObject({
      transition: 'crossfade',
      locked: true,
    });
    expect(edits.replaceClipAsset(reel, 'c1', 'a9').timeline.clips[0]).toMatchObject({ assetId: 'a9', locked: true });
  });
});

describe('caption edits', () => {
  it('edits text and locks the cue', async () => {
    const { editCaption } = await import('@/lib/reel/edits');
    const out = editCaption(await base(), 'k1', 'JUST SHIPPED');
    expect(out.timeline.captions[0]).toMatchObject({ text: 'JUST SHIPPED', locked: true });
  });

  it('nudging moves both bounds together and never goes negative', async () => {
    const { nudgeCaption } = await import('@/lib/reel/edits');
    const out = nudgeCaption(await base(), 'k1', 0.2);
    expect(out.timeline.captions[0].start).toBeCloseTo(0.7, 3);
    expect(out.timeline.captions[0].end).toBeCloseTo(1.6, 3);
    const clamped = nudgeCaption(await base(), 'k1', -99);
    expect(clamped.timeline.captions.find((c) => c.id === 'k1')!.start).toBe(0);
  });

  it('hides a cue without deleting it', async () => {
    const { toggleCaption } = await import('@/lib/reel/edits');
    const out = toggleCaption(await base(), 'k1');
    expect(out.timeline.captions.find((c) => c.id === 'k1')).toMatchObject({ hidden: true, locked: true });
  });

  it('merges a cue with the next one', async () => {
    const { mergeCaption } = await import('@/lib/reel/edits');
    const out = mergeCaption(await base(), 'k1');
    expect(out.timeline.captions).toHaveLength(1);
    expect(out.timeline.captions[0]).toMatchObject({ text: 'just launched basically an', end: 2.2 });
  });

  it('splits a cue at the middle word boundary', async () => {
    const { splitCaption } = await import('@/lib/reel/edits');
    const out = splitCaption(await base(), 'k1');
    const parts = out.timeline.captions.filter((c) => c.id.startsWith('k1'));
    expect(parts.map((p) => p.text)).toEqual(['just', 'launched']);
    expect(parts[0].end).toBeCloseTo(parts[1].start, 5);
  });

  it('leaves a one-word cue alone', async () => {
    const { splitCaption, editCaption } = await import('@/lib/reel/edits');
    const single = editCaption(await base(), 'k1', 'launched');
    expect(splitCaption(single, 'k1').timeline.captions).toHaveLength(2);
  });
});
