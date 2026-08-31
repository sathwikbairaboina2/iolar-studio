import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

beforeEach(() => {
  vi.resetModules();
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-shots-'));
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
    vo: { ...reel.vo, words: WORDS, durationSec: 5 },
    beats: [
      { id: 'b1', role: 'hook', text: 'one two', shot: { kind: 'title', brief: 'title card', hero: false , alsoAssetIds: [], sourceLineId: null } },
      { id: 'b2', role: 'body', text: 'three four', shot: { kind: 'screen', brief: 'chat ui', hero: false , alsoAssetIds: [], sourceLineId: null } },
      { id: 'b3', role: 'close', text: 'five six', shot: { kind: 'talking-head', brief: 'to camera', hero: true , alsoAssetIds: [], sourceLineId: null } },
    ],
  });
  return loadReel(slug);
}

/**
 * Registers a stand-in for both renderers.
 *
 * A researched reel has two kinds of generated shot and they are made by
 * different machines, so the seam is keyed by name; the same double answers for
 * either lookup here.
 */
function mockProvider(over: Record<string, unknown> = {}) {
  const provider = {
    name: 'webpage',
    available: vi.fn().mockResolvedValue(true),
    animate: vi.fn().mockResolvedValue({ jobId: 'p-1' }),
    jobState: vi.fn().mockResolvedValue('running'),
    collect: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
  vi.doMock('@/lib/reel/videoProvider', async (orig) => ({
    ...(await (orig() as Promise<Record<string, unknown>>)),
    videoProvider: (name: string) => ({ ...provider, name: name || provider.name }),
  }));
  return provider;
}

/** No plugin wired at all — the state the studio ships in. */
function mockNoProvider() {
  vi.doMock('@/lib/reel/videoProvider', async (orig) => ({
    ...(await (orig() as Promise<Record<string, unknown>>)),
    videoProvider: () => null,
  }));
}

/**
 * Both renderers speak this beat's slice of the voiceover, so a beat with no
 * audio waits for a human. These tests are about routing, not about cutting.
 */
function mockBeatAudio() {
  vi.doMock('@/lib/reel/build/audio', async (orig) => ({
    ...(await (orig() as Promise<Record<string, unknown>>)),
    beatAudioFile: () => __filename,
  }));
}

/** A page visit needs a page; these tests supply one without any research on disk. */
function mockLink(link: unknown = { url: 'https://example.com/a', highlight: 'phrase', candidateId: 'c1' }) {
  vi.doMock('@/lib/reel/build/links', () => ({ resolveLink: () => link }));
}


describe('shot planning', () => {
  it('skips title beats and clamps shot length into the pattern range', async () => {
    const reel = await seed();
    const { planShots } = await import('@/lib/reel/shots');
    const reqs = planShots(reel, [3, 6]);
    // b1 is a title, which is an overlay and never generated. Both of the others
    // have a renderer now: the page for b2, the presenter for b3.
    expect(reqs.map((r) => r.beatId)).toEqual(['b2', 'b3']);
    for (const r of reqs) {
      expect(r.seconds).toBeGreaterThanOrEqual(3);
      expect(r.seconds).toBeLessThanOrEqual(6);
    }
    expect(reqs.find((r) => r.beatId === 'b3')?.hero).toBe(true);
  });

  it('does not re-queue a beat whose asset is ready or already running', async () => {
    const { loadReel, saveReel } = await import('@/lib/reel/store');
    await seed();
    const reel = await loadReel('grok');
    const withAssets = {
      ...reel,
      assets: [
        { id: 'a1', kind: 'video' as const, path: 'assets/a1.mp4', origin: 'plugin' as const, status: 'ready' as const, brief: '' },
        { id: 'a2', kind: 'video' as const, path: '', origin: 'plugin' as const, status: 'running' as const, brief: '' },
      ],
      beats: reel.beats.map((b) =>
        b.id === 'b2' ? { ...b, shot: { ...b.shot, assetId: 'a1' , alsoAssetIds: [], sourceLineId: null } }
        : b.id === 'b3' ? { ...b, shot: { ...b.shot, assetId: 'a2' , alsoAssetIds: [], sourceLineId: null } }
        : b
      ),
    };
    await saveReel('grok', withAssets);
    const { planShots } = await import('@/lib/reel/shots');
    expect(planShots(await loadReel('grok'), [3, 6])).toEqual([]);
  });
});

describe('shot generation', () => {
  it('keeps hero beats on the local plugin by default, so nothing leaves the machine', async () => {
    await seed();
    mockProvider();
    mockBeatAudio();
    mockLink();
    const { runShots } = await import('@/lib/reel/shots');
    const reel = await runShots('grok');
    const heroBeat = reel.beats.find((b) => b.id === 'b3')!;
    const hero = reel.assets.find((a) => a.id === heroBeat.shot.assetId)!;
    expect(hero.origin).toBe('plugin');
  });


  it('marks a talking head awaiting-manual when no presenter image is set', async () => {
    await seed();
    mockProvider();
    mockBeatAudio();
    mockLink();
    const { runShots } = await import('@/lib/reel/shots');
    const reel = await runShots('grok');
    const beat = reel.beats.find((b) => b.id === 'b3')!;
    const asset = reel.assets.find((a) => a.id === beat.shot.assetId)!;
    expect(asset.status).toBe('awaiting-manual');
    expect(asset.error).toMatch(/presenter image/i);
  });

  // The state the studio ships in: generation belongs to the user's plugins, and
  // until one is registered a beat waits for a file rather than failing the run.
  it('marks shots awaiting-manual when no provider is wired at all', async () => {
    await seed('grok');
    mockNoProvider();
    mockBeatAudio();
    mockLink();
    const { runShots } = await import('@/lib/reel/shots');
    const reel = await runShots('grok');

    const asset = reel.assets.find((a) => a.status === 'awaiting-manual');
    expect(asset).toBeTruthy();
    expect(asset!.error).toMatch(/no video provider is wired/i);
  });

  it('marks shots awaiting-manual when the provider is down rather than failing the run', async () => {
    await seed();
    mockProvider({ available: vi.fn().mockResolvedValue(false) });
    mockBeatAudio();
    mockLink();
    const { runShots } = await import('@/lib/reel/shots');
    const reel = await runShots('grok');
    const beat = reel.beats.find((b) => b.id === 'b3')!;
    const asset = reel.assets.find((a) => a.id === beat.shot.assetId)!;
    expect(asset.status).toBe('awaiting-manual');
    expect(asset.error).toMatch(/provider/i);
  });


  it('is idempotent: a second run queues nothing new', async () => {
    await seed();
    mockProvider();
    mockBeatAudio();
    mockLink();
    const { runShots } = await import('@/lib/reel/shots');
    const first = await runShots('grok');
    const second = await runShots('grok');
    expect(second.assets.length).toBe(first.assets.length);
  });
});

describe('manual drops', () => {
  it('treats a dropped image as the seed for image-to-video, not as the shot', async () => {
    await seed();
    vi.doMock('@/lib/reel/probe', () => ({
      ffprobeMedia: vi.fn().mockResolvedValue({ durationSec: 0, width: 1080, height: 1920, fps: 0, hasAudio: false }),
    }));
    const { attachAsset, planShots } = await import('@/lib/reel/shots');
    const reel = await attachAsset('grok', 'b3', { name: 'screenshot.png', bytes: Buffer.from('img') });
    expect(reel.assets[0]).toMatchObject({ kind: 'image', brief: 'still:b3' });
    expect(reel.beats.find((b) => b.id === 'b3')!.shot.assetId).toBeUndefined();
    // still queued, because the still is what the provider will animate
    expect(planShots(reel, [3, 6]).map((r) => r.beatId)).toContain('b3');
  });

  it('uses a dropped image as the shot itself when asked', async () => {
    await seed();
    vi.doMock('@/lib/reel/probe', () => ({
      ffprobeMedia: vi.fn().mockResolvedValue({ durationSec: 0, width: 1080, height: 1920, fps: 0, hasAudio: false }),
    }));
    const { attachAsset, planShots } = await import('@/lib/reel/shots');
    const reel = await attachAsset('grok', 'b3', { name: 'card.png', bytes: Buffer.from('img') }, 'shot');
    expect(reel.beats.find((b) => b.id === 'b3')!.shot.assetId).toBe(reel.assets[0].id);
    expect(planShots(reel, [3, 6]).map((r) => r.beatId)).not.toContain('b3');
  });

  it('attaches a dropped clip to its beat and wins over generation', async () => {
    await seed();
    vi.doMock('@/lib/reel/probe', () => ({
      ffprobeMedia: vi.fn().mockResolvedValue({ durationSec: 4, width: 1080, height: 1920, fps: 30, hasAudio: false }),
    }));
    const { attachAsset } = await import('@/lib/reel/shots');
    const reel = await attachAsset('grok', 'b3', { name: 'shot.mp4', bytes: Buffer.from('video') });
    const beat = reel.beats.find((b) => b.id === 'b3')!;
    const asset = reel.assets.find((a) => a.id === beat.shot.assetId)!;
    expect(asset).toMatchObject({ origin: 'user', status: 'ready', durationSec: 4 });

    // b3 is covered by the drop; b2 still wants its page rendered.
    const { planShots } = await import('@/lib/reel/shots');
    expect(planShots(reel, [3, 6]).map((r) => r.beatId)).not.toContain('b3');
  });

  it('still attaches a file ffprobe cannot read', async () => {
    await seed();
    vi.doMock('@/lib/reel/probe', () => ({
      ffprobeMedia: vi.fn().mockRejectedValue(new Error('not media')),
    }));
    const { attachAsset } = await import('@/lib/reel/shots');
    const reel = await attachAsset('grok', 'b3', { name: 'weird.mp4', bytes: Buffer.from('x') });
    expect(reel.assets[0].status).toBe('ready');
  });
});

describe('shot refresh', () => {
  it('collects a finished provider job into the assets folder', async () => {
    await seed();
    const { loadReel, saveReel } = await import('@/lib/reel/store');
    const reel = await loadReel('grok');
    await saveReel('grok', {
      ...reel,
      assets: [
        { id: 'a1', kind: 'video', path: '', origin: 'plugin', provider: 'webpage', status: 'running', jobId: 'p-1', brief: '' },
      ],
      beats: reel.beats.map((b) => (b.id === 'b3' ? { ...b, shot: { ...b.shot, assetId: 'a1' , alsoAssetIds: [], sourceLineId: null } } : b)),
    });
    mockProvider({
      jobState: vi.fn().mockResolvedValue('ready'),
      collect: vi.fn(async (_id: string, dest: string) => {
        const { writeFileSync, mkdirSync } = await import('fs');
        mkdirSync(path.dirname(dest), { recursive: true });
        writeFileSync(dest, 'video');
        return { path: dest };
      }),
    });
    vi.doMock('@/lib/reel/probe', () => ({
      ffprobeMedia: vi.fn().mockResolvedValue({ durationSec: 5, width: 1080, height: 1920, fps: 24, hasAudio: false }),
    }));
    const { refreshShots } = await import('@/lib/reel/shots');
    const out = await refreshShots('grok');
    expect(out.assets[0]).toMatchObject({ status: 'ready', durationSec: 5 });
    expect(out.assets[0].path).toMatch(/assets[\\/]a1\.mp4/);
  });

  it('marks a failed provider job failed', async () => {
    await seed();
    const { loadReel, saveReel } = await import('@/lib/reel/store');
    const reel = await loadReel('grok');
    await saveReel('grok', {
      ...reel,
      assets: [{ id: 'a1', kind: 'video', path: '', origin: 'plugin', provider: 'webpage', status: 'running', jobId: 'p-1', brief: '' }],
    });
    mockProvider({ jobState: vi.fn().mockResolvedValue('failed') });
    const { refreshShots } = await import('@/lib/reel/shots');
    expect((await refreshShots('grok')).assets[0].status).toBe('failed');
  });
});

describe('a real browser renders text a diffusion model would melt', () => {
  it('queues screen beats now that a browser renders them', async () => {
    const reel = await seed();
    const { planShots } = await import('@/lib/reel/shots');
    // b2 is the screen beat; a video model would redraw its UI text into nonsense
    expect(planShots(reel, [3, 6]).map((r) => r.beatId)).toContain('b2');
    expect(planShots(reel, [3, 6]).map((r) => r.beatId)).toContain('b3');
  });

  // Only when nothing can render the page: with a renderer wired, promoting a
  // leftover screenshot here would silently undo every retry.
  it('gives a screen beat its own screenshot when no renderer is wired', async () => {
    await seed();
    mockNoProvider();
    vi.doMock('@/lib/reel/probe', () => ({
      ffprobeMedia: vi.fn().mockResolvedValue({ durationSec: 0, width: 1080, height: 1920, fps: 0, hasAudio: false }),
    }));
    const { attachAsset, useStillsForScreens } = await import('@/lib/reel/shots');
    await attachAsset('grok', 'b2', { name: 'ui.png', bytes: Buffer.from('img') });
    const reel = await useStillsForScreens('grok');
    const beat = reel.beats.find((b) => b.id === 'b2')!;
    const asset = reel.assets.find((a) => a.id === beat.shot.assetId)!;
    expect(asset).toMatchObject({ kind: 'image', status: 'ready' });
  });

  it('leaves a screen beat alone when it has no screenshot yet', async () => {
    await seed();
    mockNoProvider();
    const { useStillsForScreens } = await import('@/lib/reel/shots');
    const reel = await useStillsForScreens('grok');
    expect(reel.beats.find((b) => b.id === 'b2')!.shot.assetId).toBeUndefined();
  });
});

describe('a wired renderer owns its screen beats', () => {
  // retryShot clears the assetId and re-runs; useStillsForScreens used to grab the
  // beat straight back with a stale screenshot, so Retry looked like it did nothing.
  it('does not hand a screen beat back to an old screenshot', async () => {
    await seed();
    mockProvider();
    vi.doMock('@/lib/reel/probe', () => ({
      ffprobeMedia: vi.fn().mockResolvedValue({ durationSec: 0, width: 1080, height: 1920, fps: 0, hasAudio: false }),
    }));
    const { attachAsset, useStillsForScreens } = await import('@/lib/reel/shots');
    await attachAsset('grok', 'b2', { name: 'ui.png', bytes: Buffer.from('img') });

    const reel = await useStillsForScreens('grok');
    expect(reel.beats.find((b) => b.id === 'b2')!.shot.assetId).toBeUndefined();
  });
});
