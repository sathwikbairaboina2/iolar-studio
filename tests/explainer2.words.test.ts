import { describe, expect, it, vi } from 'vitest';
import { alignBeat, evenWords, mergeScriptWords, wordsToFrames } from '@/lib/explainer2/words';

describe('wordsToFrames', () => {
  it('converts seconds into absolute frames from the beat start', () => {
    const w = wordsToFrames([{ w: 'Cache', start: 0.1, end: 0.5 }, { w: 'wins', start: 0.5, end: 1 }], 100, 30);
    expect(w).toEqual([
      { w: 'Cache', startFrame: 103, endFrame: 115 },
      { w: 'wins', startFrame: 115, endFrame: 130 },
    ]);
  });
  it('gives every word at least one frame and keeps them in order', () => {
    const w = wordsToFrames([{ w: 'a', start: 0.2, end: 0.2 }, { w: 'b', start: 0.1, end: 0.3 }], 0, 30);
    expect(w[0].endFrame).toBeGreaterThan(w[0].startFrame);
    expect(w[1].startFrame).toBeGreaterThanOrEqual(w[0].startFrame);
  });
  it('clamps to the end of the clip when asked', () => {
    const w = wordsToFrames([{ w: 'a', start: 0, end: 5 }], 10, 30, 60);
    expect(w[0].endFrame).toBe(70);
  });
});

describe('evenWords', () => {
  it('spreads the words evenly over the clip, in absolute frames', () => {
    const w = evenWords('one two three four', 90, 120);
    expect(w.map((x) => x.w)).toEqual(['one', 'two', 'three', 'four']);
    expect(w[0].startFrame).toBe(90);
    expect(w[1].startFrame).toBe(120);
    expect(w[3].endFrame).toBe(210);
    for (let i = 1; i < w.length; i++) expect(w[i].startFrame).toBe(w[i - 1].endFrame);
  });
  it('is empty for no words', () => expect(evenWords('   ', 0, 100)).toEqual([]));
});

describe('mergeScriptWords', () => {
  const heard = [{ w: 'p ninety five', startFrame: 0, endFrame: 10 }, { w: 'is', startFrame: 10, endFrame: 14 }];
  it('shows the script spelling on the heard timings when the counts agree', () => {
    expect(mergeScriptWords(heard, 'P95 is')).toEqual([{ w: 'P95', startFrame: 0, endFrame: 10 }, { w: 'is', startFrame: 10, endFrame: 14 }]);
  });
  it('keeps what was heard when the counts differ', () => expect(mergeScriptWords(heard, 'P95 is fine')).toEqual(heard));
});

describe('alignBeat', () => {
  it('uses whisper and says so', async () => {
    const align = vi.fn(async () => [{ w: 'Hello', start: 0, end: 0.4 }, { w: 'world', start: 0.4, end: 0.9 }]);
    const r = await alignBeat({ text: 'Hello world', mp3: '/x/b1.mp3', beatStart: 30, voiceFrames: 30, fps: 30, align });
    expect(r.method).toBe('whisper');
    expect(r.words[0]).toEqual({ w: 'Hello', startFrame: 30, endFrame: 42 });
    expect(align).toHaveBeenCalledWith('/x/b1.mp3', 'Hello world');
  });
  it('falls back to an even spread when whisper fails, and says so', async () => {
    const align = vi.fn(async () => { throw new Error('whisper is not installed'); });
    const r = await alignBeat({ text: 'one two', mp3: '/x/b1.mp3', beatStart: 0, voiceFrames: 60, fps: 30, align });
    expect(r.method).toBe('even');
    expect(r.words).toEqual([{ w: 'one', startFrame: 0, endFrame: 30 }, { w: 'two', startFrame: 30, endFrame: 60 }]);
  });
  it('falls back too when whisper hears nothing', async () => {
    const r = await alignBeat({ text: 'one two', mp3: '/x/b1.mp3', beatStart: 0, voiceFrames: 60, fps: 30, align: async () => [] });
    expect(r.method).toBe('even');
  });
  it('uses the even spread when no aligner is given', async () => {
    expect((await alignBeat({ text: 'one', mp3: '/x', beatStart: 0, voiceFrames: 30, fps: 30 })).method).toBe('even');
  });
});
