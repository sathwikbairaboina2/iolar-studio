import { describe, expect, it } from 'vitest';
import { HOOK_PEAK_OFFSET, beatMiddle, captionMethod, computeTiming, coverFrame } from '@/lib/explainer2/timing';

describe('computeTiming', () => {
  it('runs each beat voice + 0.35 s, at least 2.2 s, the hook at least 2.5 s', () => {
    const t = computeTiming([{ id: 'b1', seconds: 1 }, { id: 'b2', seconds: 1 }, { id: 'b3', seconds: 4 }]);
    expect(t.fps).toBe(30);
    expect(t.beats[0]).toEqual({ id: 'b1', start: 0, end: 75 }); // hook floor 2.5 s
    expect(t.beats[1]).toEqual({ id: 'b2', start: 75, end: 141 }); // floor 2.2 s = 66 frames
    expect(t.beats[2]).toEqual({ id: 'b3', start: 141, end: 272 }); // 4.35 s = 130.5 -> 131 frames
    expect(t.totalFrames).toBe(272);
  });
  it('lets a long hook clip set the hook length', () => {
    const t = computeTiming([{ id: 'b1', seconds: 5 }]);
    expect(t.beats[0].end).toBe(Math.ceil(5.35 * 30));
  });
  it('beats are contiguous and end at totalFrames', () => {
    const t = computeTiming([1.3, 2.9, 3.1, 0.4].map((seconds, i) => ({ id: `b${i + 1}`, seconds })));
    t.beats.forEach((b, i) => { if (i) expect(b.start).toBe(t.beats[i - 1].end); });
    expect(t.beats[t.beats.length - 1].end).toBe(t.totalFrames);
  });
  it('honours another fps', () => expect(computeTiming([{ id: 'b1', seconds: 3 }], 60).totalFrames).toBe(Math.ceil(3.35 * 60)));
  it('beatMiddle is the middle frame of a beat', () => {
    const t = computeTiming([{ id: 'b1', seconds: 1 }, { id: 'b2', seconds: 1 }]);
    expect(beatMiddle(t, 0)).toBe(37);
    expect(beatMiddle(t, 1)).toBe(108);
  });
});

describe('coverFrame', () => {
  it('is the hook peak: 48 frames into the first beat', () => {
    expect(HOOK_PEAK_OFFSET).toBe(48);
    expect(coverFrame(computeTiming([{ id: 'b1', seconds: 3 }, { id: 'b2', seconds: 3 }]))).toBe(48);
  });
  it('stays inside a short first beat', () => {
    expect(coverFrame({ fps: 30, totalFrames: 100, beats: [{ id: 'b1', start: 0, end: 40 }, { id: 'b2', start: 40, end: 100 }] })).toBe(39);
  });
  it('copes with no beats', () => expect(coverFrame({ fps: 30, totalFrames: 0, beats: [] })).toBe(0));
});

describe('captionMethod', () => {
  const t = (...methods: (('whisper' | 'even') | undefined)[]) => ({ fps: 30, totalFrames: 10, beats: methods.map((method, i) => ({ id: `b${i}`, start: i, end: i + 1, method })) });
  it('says how the words were timed', () => {
    expect(captionMethod(t('whisper', 'whisper'))).toBe('whisper');
    expect(captionMethod(t('even', 'even'))).toBe('even');
    expect(captionMethod(t('whisper', 'even'))).toBe('mixed');
  });
  it('says none for an older timing file or no timing', () => {
    expect(captionMethod(t(undefined, undefined))).toBe('none');
    expect(captionMethod(null)).toBe('none');
  });
});

