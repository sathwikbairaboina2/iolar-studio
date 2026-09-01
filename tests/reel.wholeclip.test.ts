import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * A recording made for a stretch of the reel goes in as it came back.
 *
 * The renderer returns a continuous performance — hands carrying between seconds, framing
 * holding. Cutting it into per-beat pieces, panning across them and re-timing them against a
 * separately cut voiceover threw all of that away and put the lips out of step with the
 * words. What the plugin made is the shot.
 */

beforeEach(() => {
  vi.resetModules();
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-whole-'));
});

const WORDS = Array.from({ length: 12 }, (_, i) => ({ w: `w${i}`, start: i * 0.8, end: i * 0.8 + 0.7 }));

async function seed() {
  const { createReel, loadReel, saveReel } = await import('@/lib/reel/store');
  await createReel('grok');
  const reel = await loadReel('grok');
  await saveReel('grok', {
    ...reel,
    vo: { ...reel.vo, words: WORDS, durationSec: 9.6 },
    assets: [
      { id: 'take', kind: 'video', path: 'assets/take.mp4', origin: 'plugin', status: 'ready', provider: 'lipsync', brief: '', takeStart: 0, durationSec: 4.5 },
      { id: 'page', kind: 'video', path: 'assets/page.mp4', origin: 'plugin', status: 'ready', provider: 'webpage', brief: '', takeStart: 4.8, durationSec: 4.8 },
    ],
    beats: [
      { id: 'b1', role: 'hook', text: 'w0 w1 w2', shot: { kind: 'talking-head', brief: '', hero: false, alsoAssetIds: [], sourceLineId: null, assetId: 'take' } },
      { id: 'b2', role: 'body', text: 'w3 w4 w5', shot: { kind: 'talking-head', brief: '', hero: false, alsoAssetIds: [], sourceLineId: null, assetId: 'take' } },
      { id: 'b3', role: 'body', text: 'w6 w7 w8', shot: { kind: 'screen', brief: '', hero: false, alsoAssetIds: [], sourceLineId: 'l1', assetId: 'page' } },
      { id: 'b4', role: 'close', text: 'w9 w10 w11', shot: { kind: 'screen', brief: '', hero: false, alsoAssetIds: [], sourceLineId: 'l1', assetId: 'page' } },
    ],
  } as never);
  return loadReel('grok');
}

describe('holes between recordings', () => {
  it('leaves no black between them', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const { loadPattern } = await import('@/lib/reel/patterns');
    const tl = assemble({ reel: await seed(), pattern: await loadPattern('armand') });

    const sorted = [...tl.clips].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].start).toBeCloseTo(sorted[i - 1].end, 2);
    }
  });

  it('holds the picture to the end of the voiceover', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const { loadPattern } = await import('@/lib/reel/patterns');
    const reel = await seed();
    const tl = assemble({ reel, pattern: await loadPattern('armand') });

    // A recording shorter than the words spoken over it would otherwise end the picture
    // early and leave the last sentence playing over black.
    const end = tl.clips.reduce((m, c) => Math.max(m, c.end), 0);
    expect(end).toBeCloseTo(reel.vo.durationSec, 1);
  });

  it('will not pull the first recording back to cover the opening', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const { loadPattern } = await import('@/lib/reel/patterns');
    const reel = await seed();
    const late = { ...reel, assets: reel.assets.map((a) => (a.id === 'take' ? { ...a, takeStart: 2.5 } : a)) };
    const tl = assemble({ reel: late as never, pattern: await loadPattern('armand') });

    // A face two and a half seconds out of step with its own voice is worse than a moment
    // of black at the top.
    expect(tl.clips.find((c) => c.assetId === 'take')!.start).toBeCloseTo(2.5, 2);
  });

  it('never moves a recording off the moment it was cut for', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const { loadPattern } = await import('@/lib/reel/patterns');
    const tl = assemble({ reel: await seed(), pattern: await loadPattern('armand') });

    // The lips are in step with the words at the moment this was cut from. Sliding it to
    // close a gap is what puts them out again.
    const page = tl.clips.find((c) => c.assetId === 'page')!;
    expect(page.start).toBeCloseTo(4.8, 2);
    expect(page.srcIn).toBe(0);
  });
});

describe('a recording goes in whole', () => {
  it('gives each recording one clip, not one per beat', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const { loadPattern } = await import('@/lib/reel/patterns');
    const tl = assemble({ reel: await seed(), pattern: await loadPattern('armand') });

    expect(tl.clips.map((c) => c.assetId)).toEqual(['take', 'page']);
  });

  it('plays it from its first frame, at the moment it was cut for', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const { loadPattern } = await import('@/lib/reel/patterns');
    const tl = assemble({ reel: await seed(), pattern: await loadPattern('armand') });

    const take = tl.clips.find((c) => c.assetId === 'take')!;
    expect(take.srcIn).toBe(0);
    expect(take.start).toBeCloseTo(0, 2);
    // It runs at least its own length. It may be held past that to close a hole before the
    // next recording, which the export covers by looping — but it is never squeezed, and
    // never starts anywhere but its first frame.
    expect(take.end - take.start).toBeGreaterThanOrEqual(4.5);
  });

  it('leaves the picture alone — no camera move over footage that already moves', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const { loadPattern } = await import('@/lib/reel/patterns');
    const tl = assemble({ reel: await seed(), pattern: await loadPattern('armand') });

    for (const c of tl.clips) expect(c.motion.type).toBe('hold');
  });

  it('writes no captions', async () => {
    const { assemble } = await import('@/lib/reel/assemble');
    const { loadPattern } = await import('@/lib/reel/patterns');
    const tl = assemble({ reel: await seed(), pattern: await loadPattern('armand') });
    expect(tl.captions).toEqual([]);
  });
});
