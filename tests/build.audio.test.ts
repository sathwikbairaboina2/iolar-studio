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

describe('where a cut ends', () => {
  it('runs out into the silence after the last word', async () => {
    const { tailEnd } = await import('@/lib/reel/build/audio');
    const words = [
      { start: 0, end: 0.9 },
      { start: 2.0, end: 2.4 },
    ];
    // The span ends at 0.9; the next word starts at 2.0. The tail takes its 0.35 in full.
    expect(tailEnd(words, 0.9)).toBeCloseTo(1.25, 3);
  });

  it('never clips the onset of the next word', async () => {
    const { tailEnd } = await import('@/lib/reel/build/audio');
    const words = [
      { start: 0, end: 0.9 },
      { start: 1.0, end: 1.4 },
    ];
    // Only 0.1s of silence exists; the tail stops 0.05 clear of the next word.
    expect(tailEnd(words, 0.9)).toBeCloseTo(0.95, 3);
  });

  it('never runs past the end of the voiceover', async () => {
    const { tailEnd } = await import('@/lib/reel/build/audio');
    expect(tailEnd([{ start: 0, end: 5.0 }], 5.0, 5.1)).toBeCloseTo(5.1, 3);
  });

  it('never moves a cut earlier', async () => {
    const { tailEnd } = await import('@/lib/reel/build/audio');
    // Degenerate alignment: the next word starts before the span ends.
    expect(tailEnd([{ start: 0.8, end: 1.2 }], 0.9)).toBeCloseTo(0.9, 3);
  });
});

describe('sliceSpan', () => {
  it('pads a presenter cut up to the half-second grid instead of cutting words off', async () => {
    const calls: string[][] = [];
    vi.doMock('@/lib/reel/probe', () => ({ run: vi.fn(async (_c: string, args: string[]) => { calls.push(args); return ''; }) }));
    const { sliceSpan } = await import('@/lib/reel/build/audio');

    await sliceSpan('grok', 'presenter-0', 0, 6.72, { grid: true });

    const args = calls[0];
    // The full 6.72 seconds of words are kept...
    expect(args[args.indexOf('-t') + 1]).toBe('6.720');
    // ...and silence carries the file to 7.0, the next half-second up.
    expect(args[args.indexOf('-af') + 1]).toBe('apad=whole_dur=7.000');
  });

  it('cuts a page group exactly, with no grid', async () => {
    const calls: string[][] = [];
    vi.doMock('@/lib/reel/probe', () => ({ run: vi.fn(async (_c: string, args: string[]) => { calls.push(args); return ''; }) }));
    const { sliceSpan } = await import('@/lib/reel/build/audio');

    await sliceSpan('grok', 'page-x', 1.5, 4.72);

    const args = calls[0];
    expect(args[args.indexOf('-t') + 1]).toBe('3.220');
    expect(args).not.toContain('-af');
  });

  it('lets the cut breathe out through the word timings it is given', async () => {
    const calls: string[][] = [];
    vi.doMock('@/lib/reel/probe', () => ({ run: vi.fn(async (_c: string, args: string[]) => { calls.push(args); return ''; }) }));
    const { sliceSpan } = await import('@/lib/reel/build/audio');

    const words = [
      { start: 0, end: 3.0 },
      { start: 4.0, end: 4.5 },
    ];
    await sliceSpan('grok', 'page-y', 0, 3.0, { words });

    const args = calls[0];
    // 3.0 + the full 0.35 tail: the next word is far enough away.
    expect(args[args.indexOf('-t') + 1]).toBe('3.350');
  });
});
