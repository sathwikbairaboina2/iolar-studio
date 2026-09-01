import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * Getting a stuck shot moving again, from the studio.
 *
 * Three things go wrong in practice: the renderer makes something unusable, the beat can
 * never be rendered as planned, or the job is simply gone. Each has a way out that does not
 * involve a scratch script and a restart.
 */

beforeEach(() => {
  vi.resetModules();
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-recover-'));
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
    assets: [
      { id: 'a1', kind: 'video', path: '', origin: 'plugin', status: 'running', jobId: 'p-1', provider: 'webpage', brief: 'chat ui' },
      { id: 'a2', kind: 'video', path: '', origin: 'plugin', status: 'failed', error: 'tensor shape', brief: 'to camera' },
    ],
    beats: [
      { id: 'b1', role: 'hook', text: 'one two', shot: { kind: 'title', brief: '', hero: false, alsoAssetIds: [], sourceLineId: null } },
      { id: 'b2', role: 'body', text: 'three four', shot: { kind: 'screen', brief: 'chat ui', hero: false, alsoAssetIds: [], sourceLineId: 'l1', assetId: 'a1' } },
      { id: 'b3', role: 'close', text: 'five six', shot: { kind: 'talking-head', brief: 'to camera', hero: true, alsoAssetIds: [], sourceLineId: null, assetId: 'a2' } },
    ],
  });
  return loadReel(slug);
}

function mockProvider() {
  const provider = {
    name: 'webpage',
    available: vi.fn().mockResolvedValue(true),
    animate: vi.fn().mockResolvedValue({ jobId: 'p-2' }),
    jobState: vi.fn().mockResolvedValue('running'),
    collect: vi.fn().mockResolvedValue(undefined),
  };
  vi.doMock('@/lib/reel/videoProvider', async (orig) => ({
    ...(await (orig() as Promise<Record<string, unknown>>)),
    videoProvider: (name: string) => ({ ...provider, name: name || provider.name }),
  }));
  vi.doMock('@/lib/reel/build/audio', async (orig) => ({
    ...(await (orig() as Promise<Record<string, unknown>>)),
    beatAudioFile: () => __filename,
  }));
  vi.doMock('@/lib/settings', async (orig) => ({
    ...(await (orig() as Promise<Record<string, unknown>>)),
    getSettings: () => ({ presenterImage: 'C:/presenter.png' }),
  }));
  return provider;
}

describe('recasting a beat that cannot be rendered as planned', () => {
  it('turns a page shot into a talking head and lets it be planned again', async () => {
    await seed();
    const { recastShot } = await import('@/lib/reel/shots');

    const reel = await recastShot('grok', 'b2', 'talking-head');

    const beat = reel.beats.find((b) => b.id === 'b2')!;
    expect(beat.shot.kind).toBe('talking-head');
    // The old asset is let go, so the beat is plannable rather than pointing at a dead job.
    expect(beat.shot.assetId).toBeFalsy();
  });

  it('queues nothing by itself — the gate decides what gets sent', async () => {
    await seed();
    const provider = mockProvider();
    const { recastShot } = await import('@/lib/reel/shots');

    await recastShot('grok', 'b2', 'talking-head');
    expect(provider.animate).not.toHaveBeenCalled();
  });

  it('refuses a kind no renderer makes', async () => {
    await seed();
    const { recastShot } = await import('@/lib/reel/shots');
    await expect(recastShot('grok', 'b2', 'broll' as never)).rejects.toThrow(/broll/i);
  });
});

describe('abandoning a job nobody is coming back to', () => {
  it('parks the beat on a human instead of polling a job for ever', async () => {
    await seed();
    const { abandonShot } = await import('@/lib/reel/shots');

    const reel = await abandonShot('grok', 'b2', 'renderer restarted, job is gone');

    const asset = reel.assets.find((a) => a.id === 'a1')!;
    expect(asset.status).toBe('awaiting-manual');
    expect(asset.error).toMatch(/job is gone/);
    // The beat keeps pointing at it, so the studio still offers the drop target.
    expect(reel.beats.find((b) => b.id === 'b2')!.shot.assetId).toBe('a1');
  });

  it('leaves a shot that already landed alone', async () => {
    const { loadReel, saveReel } = await import('@/lib/reel/store');
    await seed();
    const reel = await loadReel('grok');
    await saveReel('grok', {
      ...reel,
      assets: reel.assets.map((a) => (a.id === 'a1' ? { ...a, status: 'ready' as const, path: 'assets/a1.mp4' } : a)),
    });
    const { abandonShot } = await import('@/lib/reel/shots');

    await expect(abandonShot('grok', 'b2', 'gone')).rejects.toThrow(/ready/i);
  });
});

describe('retrying a shot that covers several beats', () => {
  it('re-renders the whole stretch, not the one beat you clicked', async () => {
    const { loadReel, saveReel } = await import('@/lib/reel/store');
    await seed();
    const reel = await loadReel('grok');
    // One recording covering b2 and b3, the way a bite or a page visit is stored.
    await saveReel('grok', {
      ...reel,
      assets: [{ id: 'a1', kind: 'video', path: '', origin: 'plugin', status: 'failed', provider: 'lipsync', brief: '', takeStart: 0 }],
      // Both beats are the same picture, which is what makes them one recording.
      beats: reel.beats.map((b) =>
        b.id === 'b1' ? b : { ...b, shot: { ...b.shot, kind: 'talking-head', sourceLineId: null, assetId: 'a1' } }
      ),
    } as never);

    const { retryShot } = await import('@/lib/reel/shots');
    mockProvider();
    // Half-finished: b2 has moved to a new asset while its neighbour still points at the dead
    // one, which is what a failed retry leaves behind.
    await saveReel('grok', {
      ...(await loadReel('grok')),
      beats: (await loadReel('grok')).beats.map((b) =>
        b.id === 'b2' ? { ...b, shot: { ...b.shot, assetId: 'a9' } } : b
      ),
    } as never);
    const out = await retryShot('grok', 'b2');

    // Leaving b3 pointed at the dead asset re-rendered b2 alone: a second and a half of a
    // face, which is the shot length this planner exists to avoid.
    const b2 = out.beats.find((b) => b.id === 'b2')!.shot.assetId;
    const b3 = out.beats.find((b) => b.id === 'b3')!.shot.assetId;
    expect(b2).toBe(b3);
    expect(b2).not.toBe('a1');
  });
});

describe('retrying one shot', () => {
  it('re-queues that beat and nothing else', async () => {
    await seed();
    const provider = mockProvider();
    const { retryShot } = await import('@/lib/reel/shots');

    await retryShot('grok', 'b3', 'tighter framing');

    expect(provider.animate).toHaveBeenCalledTimes(1);
    const { loadReel } = await import('@/lib/reel/store');
    expect((await loadReel('grok')).beats.find((b) => b.id === 'b3')!.shot.brief).toBe('tighter framing');
  });
});
