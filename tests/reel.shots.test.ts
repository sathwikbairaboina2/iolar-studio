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
      { id: 'b1', role: 'hook', text: 'one two', shot: { kind: 'title', brief: 'title card', hero: false } },
      { id: 'b2', role: 'body', text: 'three four', shot: { kind: 'screen', brief: 'chat ui', hero: false } },
      { id: 'b3', role: 'close', text: 'five six', shot: { kind: 'broll', brief: 'city', hero: true } },
    ],
  });
  return loadReel(slug);
}

function mockComfy(over: Record<string, unknown> = {}) {
  vi.doMock('@/lib/comfy/i2v', () => ({
    i2vAvailable: vi.fn().mockResolvedValue(true),
    animateImage: vi.fn().mockResolvedValue({ promptId: 'p-1', workflow: 'w.json' }),
    collectVideo: vi.fn().mockResolvedValue({ path: 'x.mp4' }),
    jobState: vi.fn().mockResolvedValue('running'),
    ...over,
  }));
}

function mockHf(over: Record<string, unknown> = {}) {
  vi.doMock('@/lib/higgsfield/client', () => ({
    hfGenerateVideo: vi.fn().mockResolvedValue({ url: 'https://cdn/hero.mp4' }),
    downloadTo: vi.fn(async (_u: string, dest: string) => {
      const { writeFileSync, mkdirSync } = await import('fs');
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, 'video');
    }),
    HiggsfieldUnavailableError: class extends Error {},
    ...over,
  }));
}

describe('shot planning', () => {
  it('skips title beats and clamps shot length into the pattern range', async () => {
    const reel = await seed();
    const { planShots } = await import('@/lib/reel/shots');
    const reqs = planShots(reel, [3, 6]);
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
        { id: 'a1', kind: 'video' as const, path: 'assets/a1.mp4', origin: 'comfy' as const, status: 'ready' as const, brief: '' },
        { id: 'a2', kind: 'video' as const, path: '', origin: 'comfy' as const, status: 'running' as const, brief: '' },
      ],
      beats: reel.beats.map((b) =>
        b.id === 'b2' ? { ...b, shot: { ...b.shot, assetId: 'a1' } }
        : b.id === 'b3' ? { ...b, shot: { ...b.shot, assetId: 'a2' } }
        : b
      ),
    };
    await saveReel('grok', withAssets);
    const { planShots } = await import('@/lib/reel/shots');
    expect(planShots(await loadReel('grok'), [3, 6])).toEqual([]);
  });
});

describe('shot generation', () => {
  it('sends hero beats to higgsfield and marks them ready', async () => {
    await seed();
    mockComfy();
    mockHf();
    const { runShots } = await import('@/lib/reel/shots');
    const reel = await runShots('grok');
    const heroBeat = reel.beats.find((b) => b.id === 'b3')!;
    const hero = reel.assets.find((a) => a.id === heroBeat.shot.assetId)!;
    expect(hero.origin).toBe('higgsfield');
    expect(hero.status).toBe('ready');
    expect(hero.path).toMatch(/assets[\\/]a\d+\.mp4/);
  });

  it('marks a comfy shot awaiting-manual when there is no source still', async () => {
    await seed();
    mockComfy();
    mockHf();
    const { runShots } = await import('@/lib/reel/shots');
    const reel = await runShots('grok');
    const beat = reel.beats.find((b) => b.id === 'b2')!;
    const asset = reel.assets.find((a) => a.id === beat.shot.assetId)!;
    expect(asset.status).toBe('awaiting-manual');
    expect(asset.error).toMatch(/screenshot/i);
  });

  it('marks shots awaiting-manual when ComfyUI is down rather than failing the run', async () => {
    await seed();
    mockComfy({ i2vAvailable: vi.fn().mockResolvedValue(false) });
    mockHf();
    const { runShots } = await import('@/lib/reel/shots');
    const reel = await runShots('grok');
    const beat = reel.beats.find((b) => b.id === 'b2')!;
    const asset = reel.assets.find((a) => a.id === beat.shot.assetId)!;
    expect(asset.status).toBe('awaiting-manual');
    expect(asset.error).toMatch(/ComfyUI/);
  });

  it('records a failed hero generation without stopping the rest', async () => {
    await seed();
    mockComfy();
    mockHf({ hfGenerateVideo: vi.fn().mockRejectedValue(new Error('credits exhausted')) });
    const { runShots } = await import('@/lib/reel/shots');
    const reel = await runShots('grok');
    const hero = reel.assets.find((a) => a.origin === 'higgsfield')!;
    expect(hero.status).toBe('failed');
    expect(hero.error).toMatch(/credits/);
    expect(reel.assets).toHaveLength(2);
  });

  it('is idempotent: a second run queues nothing new', async () => {
    await seed();
    mockComfy();
    mockHf();
    const { runShots } = await import('@/lib/reel/shots');
    const first = await runShots('grok');
    const second = await runShots('grok');
    expect(second.assets.length).toBe(first.assets.length);
  });
});

describe('manual drops', () => {
  it('attaches a dropped file to its beat and wins over generation', async () => {
    await seed();
    vi.doMock('@/lib/reel/probe', () => ({
      ffprobeMedia: vi.fn().mockResolvedValue({ durationSec: 4, width: 1080, height: 1920, fps: 30, hasAudio: false }),
    }));
    const { attachAsset } = await import('@/lib/reel/shots');
    const reel = await attachAsset('grok', 'b2', { name: 'shot.mp4', bytes: Buffer.from('video') });
    const beat = reel.beats.find((b) => b.id === 'b2')!;
    const asset = reel.assets.find((a) => a.id === beat.shot.assetId)!;
    expect(asset).toMatchObject({ origin: 'user', status: 'ready', durationSec: 4 });

    const { planShots } = await import('@/lib/reel/shots');
    expect(planShots(reel, [3, 6]).map((r) => r.beatId)).toEqual(['b3']);
  });

  it('still attaches a file ffprobe cannot read', async () => {
    await seed();
    vi.doMock('@/lib/reel/probe', () => ({
      ffprobeMedia: vi.fn().mockRejectedValue(new Error('not media')),
    }));
    const { attachAsset } = await import('@/lib/reel/shots');
    const reel = await attachAsset('grok', 'b2', { name: 'weird.mp4', bytes: Buffer.from('x') });
    expect(reel.assets[0].status).toBe('ready');
  });
});

describe('shot refresh', () => {
  it('collects a finished comfy job into the assets folder', async () => {
    await seed();
    const { loadReel, saveReel } = await import('@/lib/reel/store');
    const reel = await loadReel('grok');
    await saveReel('grok', {
      ...reel,
      assets: [
        { id: 'a1', kind: 'video', path: '', origin: 'comfy', status: 'running', jobId: 'p-1', brief: '' },
      ],
      beats: reel.beats.map((b) => (b.id === 'b2' ? { ...b, shot: { ...b.shot, assetId: 'a1' } } : b)),
    });
    mockComfy({
      jobState: vi.fn().mockResolvedValue('ready'),
      collectVideo: vi.fn(async (_id: string, dest: string) => {
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

  it('marks a failed comfy job failed', async () => {
    await seed();
    const { loadReel, saveReel } = await import('@/lib/reel/store');
    const reel = await loadReel('grok');
    await saveReel('grok', {
      ...reel,
      assets: [{ id: 'a1', kind: 'video', path: '', origin: 'comfy', status: 'running', jobId: 'p-1', brief: '' }],
    });
    mockComfy({ jobState: vi.fn().mockResolvedValue('failed') });
    const { refreshShots } = await import('@/lib/reel/shots');
    expect((await refreshShots('grok')).assets[0].status).toBe('failed');
  });
});
