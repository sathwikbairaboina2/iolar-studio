import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

let ffmpeg = false;

beforeAll(async () => {
  const { ffmpegAvailable } = await import('@/lib/reel/probe');
  ffmpeg = await ffmpegAvailable();
});

describe('clone analysis', () => {
  it('turns cut timestamps into shot lengths including head and tail', async () => {
    const { shotLengths } = await import('@/lib/reel/clone');
    expect(shotLengths([3, 8], 12)).toEqual([3, 5, 4]);
    expect(shotLengths([], 5)).toEqual([5]);
    expect(shotLengths([0.05, 4], 8)).toEqual([4, 4]);
  });

  it('reads percentiles for the pacing range', async () => {
    const { percentile } = await import('@/lib/reel/clone');
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([], 0.5)).toBe(0);
  });

  it('turns measured band-change gaps and word timings into words per beat', async () => {
    const { wordsPerBeatFrom } = await import('@/lib/reel/clone');
    // 3 words per second of speech, captions changing about once a second
    const words = Array.from({ length: 30 }, (_, i) => ({ w: `w${i}`, start: i / 3, end: i / 3 + 0.3 }));
    const [lo, hi] = wordsPerBeatFrom(words, [1, 1, 1, 1]);
    expect(lo).toBeLessThanOrEqual(3);
    expect(hi).toBeGreaterThanOrEqual(3);
  });

  it('falls back to sensible defaults without enough beats to measure', async () => {
    const { wordsPerBeatFrom } = await import('@/lib/reel/clone');
    expect(wordsPerBeatFrom([{ w: 'hi', start: 0, end: 0.2 }], [])).toEqual([1, 3]);
  });

  it('finds the caption band height and centre in a synthetic frame', async () => {
    if (!ffmpeg) return;
    const { run } = await import('@/lib/reel/probe');
    const { measureCaptionBand } = await import('@/lib/reel/clone');
    const dir = mkdtempSync(path.join(tmpdir(), 'reel-band-'));
    const file = path.join(dir, 'band.png');
    // A white bar 60px tall centred at 73% of a 1920-tall frame, on black.
    await run('ffmpeg', [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=black:s=1080x1920',
      '-vf', 'drawbox=x=340:y=1372:w=400:h=60:color=white@1:t=fill',
      '-frames:v', '1', file,
    ]);
    // Two frames: one lucky frame is not a caption band, so the detector wants corroboration.
    const band = await measureCaptionBand([file, file]);
    expect(band).not.toBeNull();
    expect(Math.abs(band!.yPct - 73)).toBeLessThan(2);
    expect(band!.sizeVh).toBeGreaterThan(3);
    expect(band!.sizeVh).toBeLessThan(6);
    expect(band!.pill).toBe('#000000'); // the probe above the glyphs lands on the dark backing
  }, 60_000);

  it('reports no band on a frame with nothing bright in the lower half', async () => {
    if (!ffmpeg) return;
    const { run } = await import('@/lib/reel/probe');
    const { measureCaptionBand } = await import('@/lib/reel/clone');
    const dir = mkdtempSync(path.join(tmpdir(), 'reel-band2-'));
    const file = path.join(dir, 'plain.png');
    await run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=1080x1920', '-frames:v', '1', file]);
    expect(await measureCaptionBand([file, file])).toBeNull();
  }, 60_000);
});
