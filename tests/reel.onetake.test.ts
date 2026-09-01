import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * One take for the whole reel, cut into shots afterwards.
 *
 * Rendering a beat at a time gave the model a second and a half of audio and a photo, over
 * and over: every cut reset the pose, so hands teleported and the head snapped back to
 * centre thirteen times in twenty seconds. Handed the whole voiceover it renders one
 * continuous performance, and the timeline cuts within it — which is what a jump cut is.
 */

beforeEach(() => {
  vi.resetModules();
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-take-'));
});

const WORDS = ['one', 'two', 'three', 'four', 'five', 'six'].map((w, i) => ({
  w,
  start: i * 0.8,
  end: i * 0.8 + 0.7,
}));

async function seed(slug = 'grok') {
  const { createReel, loadReel, saveReel } = await import('@/lib/reel/store');
  await createReel(slug);
  const reel = await loadReel(slug);
  await saveReel(slug, {
    ...reel,
    vo: { ...reel.vo, words: WORDS, durationSec: 4.8 },
    beats: [
      { id: 'b1', role: 'hook', text: 'one two', shot: { kind: 'talking-head', brief: '', hero: false, alsoAssetIds: [], sourceLineId: null } },
      { id: 'b2', role: 'body', text: 'three four', shot: { kind: 'talking-head', brief: '', hero: false, alsoAssetIds: [], sourceLineId: null } },
      { id: 'b3', role: 'close', text: 'five six', shot: { kind: 'talking-head', brief: '', hero: false, alsoAssetIds: [], sourceLineId: null } },
    ],
  });
  return loadReel(slug);
}

describe('planning one take', () => {
  it('asks for a single render of the whole voiceover, not one per beat', async () => {
    const reel = await seed();
    const { planTake } = await import('@/lib/reel/shots');

    const take = planTake(reel, 'grok');

    expect(take).toMatchObject({ kind: 'talking-head', seconds: 4.8 });
    expect(take!.audioPath).toMatch(/vo\.mp3$/);
  });

  it('has nothing to ask for when the voiceover is not aligned yet', async () => {
    const { createReel, loadReel } = await import('@/lib/reel/store');
    await createReel('bare');
    const { planTake } = await import('@/lib/reel/shots');
    expect(planTake(await loadReel('bare'), 'bare')).toBeNull();
  });

  it('will not use one take for a reel that wants page shots', async () => {
    const { loadReel, saveReel } = await import('@/lib/reel/store');
    const reel = await seed();
    const mixed = {
      ...reel,
      beats: reel.beats.map((b, i) => (i === 1 ? { ...b, shot: { ...b.shot, kind: 'screen' as const } } : b)),
    };
    await saveReel('grok', mixed);
    const { planTake } = await import('@/lib/reel/shots');
    // A page beat is a different renderer and a different picture; one take cannot cover it.
    expect(planTake(await loadReel('grok'), 'grok')).toBeNull();
  });
});

describe('cutting inside the take', () => {
  it('gives every clip the offset it sits at in the take', async () => {
    const { loadReel, saveReel } = await import('@/lib/reel/store');
    const { loadPattern } = await import('@/lib/reel/patterns');
    const reel = await seed();
    await saveReel('grok', {
      ...reel,
      assets: [
        { id: 'take1', kind: 'video', path: 'assets/take1.mp4', origin: 'plugin', status: 'ready', brief: '', fullTake: true, durationSec: 4.8 },
      ],
      beats: reel.beats.map((b) => ({ ...b, shot: { ...b.shot, assetId: 'take1' } })),
    } as never);

    const { assemble } = await import('@/lib/reel/assemble');
    const tl = assemble({ reel: await loadReel('grok'), pattern: await loadPattern('armand') });

    expect(tl.clips.length).toBeGreaterThan(1);
    for (const c of tl.clips) {
      // The take runs to the same clock as the reel, so a clip at 2.4s shows second 2.4 of
      // it. Starting each one at zero would replay the opening under every line.
      expect(c.srcIn).toBeCloseTo(c.start, 2);
    }
  });
});
