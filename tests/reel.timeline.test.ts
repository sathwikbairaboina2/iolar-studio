import { describe, it, expect } from 'vitest';

const clip = (id: string, start: number, end: number) => ({
  id,
  assetId: `a-${id}`,
  start,
  end,
  srcIn: 0,
  fit: 'cover' as const,
  motion: { type: 'zoom-in' as const, strength: 0.12, origin: [0.5, 0.5] as [number, number] },
  transition: 'cut' as const,
  locked: false,
});

const tl = {
  clips: [clip('c1', 0, 4), clip('c2', 4, 9)],
  captions: [
    { id: 'k1', text: 'just launched', start: 0.5, end: 1.4, hidden: false, locked: false },
    { id: 'k2', text: 'hidden one', start: 2, end: 3, hidden: true, locked: false },
  ],
  overlays: [{ id: 'o1', kind: 'hook-title' as const, start: 0.4, end: 1.6, props: {}, locked: false }],
  music: { path: null, gainDb: -18, duckDb: -12 },
};

describe('timeline resolver', () => {
  it('reports duration as the last clip end', async () => {
    const { timelineDuration } = await import('@/lib/reel/timeline');
    expect(timelineDuration(tl)).toBe(9);
  });

  it('finds the clip covering a time, half-open at the end', async () => {
    const { clipAt } = await import('@/lib/reel/timeline');
    expect(clipAt(tl, 0)?.id).toBe('c1');
    expect(clipAt(tl, 3.999)?.id).toBe('c1');
    expect(clipAt(tl, 4)?.id).toBe('c2');
    expect(clipAt(tl, 9)).toBeNull();
  });

  it('reports progress within the clip', async () => {
    const { clipAt, clipProgress } = await import('@/lib/reel/timeline');
    const c = clipAt(tl, 6.5)!;
    expect(clipProgress(c, 6.5)).toBeCloseTo(0.5, 5);
  });

  it('skips hidden captions', async () => {
    const { captionsAt } = await import('@/lib/reel/timeline');
    expect(captionsAt(tl, 1).map((c) => c.id)).toEqual(['k1']);
    expect(captionsAt(tl, 2.5)).toEqual([]);
  });

  it('returns a whole frame in one call', async () => {
    const { frameAt } = await import('@/lib/reel/timeline');
    const f = frameAt(tl, 1);
    expect(f.clip?.id).toBe('c1');
    expect(f.captions.map((c) => c.text)).toEqual(['just launched']);
    expect(f.overlays.map((o) => o.id)).toEqual(['o1']);
  });

  it('sorts everything by start time', async () => {
    const { sortTimeline } = await import('@/lib/reel/timeline');
    const messy = { ...tl, clips: [clip('c2', 4, 9), clip('c1', 0, 4)] };
    expect(sortTimeline(messy).clips.map((c) => c.id)).toEqual(['c1', 'c2']);
  });
});
