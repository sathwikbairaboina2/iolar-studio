import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => vi.resetModules());

const reel = (over: Record<string, unknown> = {}) => ({
  slug: 'grok',
  beats: [
    { id: 'b1', role: 'hook', text: 'One two', shot: { kind: 'screen', brief: '', hero: false, alsoAssetIds: [], sourceLineId: 'l1' } },
    { id: 'b2', role: 'close', text: 'three four', shot: { kind: 'title', brief: '', hero: false, alsoAssetIds: [], sourceLineId: null } },
  ],
  vo: {
    words: [
      { w: 'One', start: 0, end: 0.4 },
      { w: 'two', start: 0.4, end: 0.9 },
      { w: 'three', start: 1.0, end: 1.4 },
      { w: 'four', start: 1.4, end: 2.0 },
    ],
  },
  ...over,
});

describe('sliceBeatAudio', () => {
  it('cuts one file per beat at the aligned span', async () => {
    const calls: string[][] = [];
    vi.doMock('@/lib/reel/probe', () => ({ run: vi.fn(async (_c: string, args: string[]) => { calls.push(args); return ''; }) }));
    const { sliceBeatAudio } = await import('@/lib/reel/build/audio');

    const out = await sliceBeatAudio('grok', reel() as never);

    expect(Object.keys(out)).toEqual(['b1', 'b2']);
    expect(calls).toHaveLength(2);
    // b1 spans its two words: 0 -> 0.9
    expect(calls[0]).toContain('0.000');
    expect(calls[0]).toContain('0.900');
  });

  // wav2vec2 drives the lipsync and reads mono 16k; a page visit only needs the length.
  it('writes mono 16 kHz pcm, which is what the lipsync encoder reads', async () => {
    const calls: string[][] = [];
    vi.doMock('@/lib/reel/probe', () => ({ run: vi.fn(async (_c: string, args: string[]) => { calls.push(args); return ''; }) }));
    const { sliceBeatAudio } = await import('@/lib/reel/build/audio');
    await sliceBeatAudio('grok', reel() as never);

    expect(calls[0]).toEqual(expect.arrayContaining(['-ac', '1', '-ar', '16000']));
  });

  it('refuses when the voiceover was never aligned', async () => {
    vi.doMock('@/lib/reel/probe', () => ({ run: vi.fn() }));
    const { sliceBeatAudio, NoAlignmentError } = await import('@/lib/reel/build/audio');

    await expect(sliceBeatAudio('grok', reel({ vo: { words: [] } }) as never)).rejects.toBeInstanceOf(NoAlignmentError);
  });

  // A title card speaks nothing, so there is no audio to cut for it.
  it('skips a beat the words do not reach', async () => {
    vi.doMock('@/lib/reel/probe', () => ({ run: vi.fn(async () => '') }));
    const { sliceBeatAudio } = await import('@/lib/reel/build/audio');

    const out = await sliceBeatAudio('grok', reel({ vo: { words: [{ w: 'One', start: 0, end: 0.4 }, { w: 'two', start: 0.4, end: 0.9 }] } }) as never);
    expect(Object.keys(out)).toEqual(['b1']);
  });
});
