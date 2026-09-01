import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * Nothing reaches a renderer unseen.
 *
 * A talking-head shot costs about thirteen minutes on this machine, so a bad brief or a
 * missing page is expensive to discover after the fact. The preview answers exactly what
 * would be sent — and answers it without queueing anything.
 */

beforeEach(() => {
  vi.resetModules();
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-gate-'));
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
      { id: 'b1', role: 'hook', text: 'one two', shot: { kind: 'title', brief: 'title card', hero: false, alsoAssetIds: [], sourceLineId: null } },
      { id: 'b2', role: 'body', text: 'three four', shot: { kind: 'screen', brief: 'chat ui', hero: false, alsoAssetIds: [], sourceLineId: 'l1' } },
      { id: 'b3', role: 'close', text: 'five six', shot: { kind: 'talking-head', brief: 'to camera', hero: true, alsoAssetIds: [], sourceLineId: null } },
    ],
  });
  return loadReel(slug);
}

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

/** Research on disk is what gives a page beat a line to resolve; these tests stand in for it. */
function mockScript() {
  vi.doMock('@/lib/reel/research/store', async (orig) => ({
    ...(await (orig() as Promise<Record<string, unknown>>)),
    readScript: async () => ({ lines: [{ id: 'l1', text: 'three four', citations: ['c1'] }] }),
    readCandidates: async () => ({ candidates: [{ id: 'c1', url: 'https://example.com/a' }] }),
  }));
}

function mockNoAudio() {
  vi.doMock('@/lib/reel/build/audio', async (orig) => ({
    ...(await (orig() as Promise<Record<string, unknown>>)),
    beatAudioFile: () => path.join(__dirname, 'no-such-beat-audio.wav'),
  }));
}

function mockBeatAudio() {
  vi.doMock('@/lib/reel/build/audio', async (orig) => ({
    ...(await (orig() as Promise<Record<string, unknown>>)),
    beatAudioFile: () => __filename,
  }));
}

function mockLink(link: unknown = { url: 'https://example.com/a', highlight: 'phrase', candidateId: 'c1' }) {
  vi.doMock('@/lib/reel/build/links', () => ({ resolveLink: () => link }));
}

function mockPresenter(image = 'C:/presenter.png', over: Record<string, unknown> = {}) {
  vi.doMock('@/lib/settings', async (orig) => ({
    ...(await (orig() as Promise<Record<string, unknown>>)),
    getSettings: () => ({ presenterImage: image, lipsyncSteps: 10, lipsyncFps: 0, ...over }),
  }));
}

describe('shot preview', () => {
  it('says what each renderer would be sent, without queueing any of it', async () => {
    await seed();
    mockProvider();
    mockBeatAudio();
    mockScript();
    mockLink();
    mockPresenter();
    const { previewShots } = await import('@/lib/reel/shots');
    const { loadReel } = await import('@/lib/reel/store');

    const rows = await previewShots('grok');

    expect(rows.map((r) => r.beatId)).toEqual(['b2', 'b3']);
    const page = rows.find((r) => r.beatId === 'b2')!;
    expect(page).toMatchObject({ provider: 'webpage', brief: 'chat ui', url: 'https://example.com/a', highlight: 'phrase' });
    expect(page.seconds).toBeGreaterThan(0);
    const head = rows.find((r) => r.beatId === 'b3')!;
    expect(head).toMatchObject({ provider: 'lipsync', imagePath: 'C:/presenter.png' });
    for (const r of rows) expect(r.blocked).toBeNull();

    // The whole point: looking costs nothing.
    expect((await loadReel('grok')).assets).toHaveLength(0);
  });

  it('shows the request itself, not a summary of it', async () => {
    await seed();
    mockProvider();
    mockBeatAudio();
    mockScript();
    mockLink();
    mockPresenter();
    const { previewShots } = await import('@/lib/reel/shots');

    const head = (await previewShots('grok')).find((r) => r.beatId === 'b3')!;

    // The point of a gate is that you can read what is about to be spent, including the
    // settings that decide whether the shot comes back usable.
    expect(head.payload).toMatchObject({
      image: 'C:/presenter.png',
      prompt: 'to camera',
      preset: 'portrait',
      steps: 10,
      fps: 30,
    });
    expect(head.payload!.seed).toEqual(expect.any(Number));

    const page = (await previewShots('grok')).find((r) => r.beatId === 'b2')!;
    expect(page.payload).toMatchObject({ url: 'https://example.com/a', highlight: 'phrase' });
  });

  it('renders at the rate the settings ask for, over the reel’s own', async () => {
    await seed();
    mockProvider();
    mockBeatAudio();
    mockScript();
    mockLink();
    mockPresenter('C:/presenter.png', { lipsyncFps: 24, lipsyncSteps: 4 });
    const { previewShots } = await import('@/lib/reel/shots');

    const head = (await previewShots('grok')).find((r) => r.beatId === 'b3')!;
    expect(head.payload).toMatchObject({ fps: 24, steps: 4 });
  });

  it('names what is missing rather than letting the run discover it', async () => {
    await seed();
    mockProvider();
    mockNoAudio();
    mockScript();
    mockLink(null);
    mockPresenter('');
    const { previewShots } = await import('@/lib/reel/shots');

    const rows = await previewShots('grok');
    expect(rows.find((r) => r.beatId === 'b2')!.blocked).toMatch(/audio/i);
    expect(rows.find((r) => r.beatId === 'b3')!.blocked).toMatch(/audio/i);
  });

  it('reports a page beat whose line cites nothing', async () => {
    await seed();
    mockProvider();
    mockBeatAudio();
    mockLink(null);
    mockPresenter();
    const { previewShots } = await import('@/lib/reel/shots');

    const rows = await previewShots('grok');
    expect(rows.find((r) => r.beatId === 'b2')!.blocked).toMatch(/cites nothing/i);
    expect(rows.find((r) => r.beatId === 'b3')!.blocked).toBeNull();
  });

  it('reports a missing presenter image', async () => {
    await seed();
    mockProvider();
    mockBeatAudio();
    mockLink();
    mockPresenter('');
    const { previewShots } = await import('@/lib/reel/shots');

    const rows = await previewShots('grok');
    expect(rows.find((r) => r.beatId === 'b3')!.blocked).toMatch(/presenter/i);
  });

  it('reports a renderer that is not wired up', async () => {
    await seed();
    mockBeatAudio();
    mockScript();
    mockLink();
    mockPresenter();
    vi.doMock('@/lib/reel/videoProvider', async (orig) => ({
      ...(await (orig() as Promise<Record<string, unknown>>)),
      videoProvider: () => null,
    }));
    const { previewShots } = await import('@/lib/reel/shots');

    const rows = await previewShots('grok');
    for (const r of rows) expect(r.blocked).toBeTruthy();
  });
});

describe('every shot gets its own take', () => {
  it('folds the beat into the seed so no two shots repeat the same performance', async () => {
    const { seedForBeat } = await import('@/lib/reel/shots');
    // One seed for the reel gave thirteen beats the same tilt of the head and the same
    // hands, which is most of why the reel read as generated.
    expect(seedForBeat(42, 'b1')).not.toBe(seedForBeat(42, 'b2'));
    // Reproducible, though: the same reel and beat is the same take.
    expect(seedForBeat(42, 'b1')).toBe(seedForBeat(42, 'b1'));
    expect(seedForBeat(42, 'b1')).toBeLessThan(2147483647);
  });
});

describe('rendering only what was approved', () => {
  it('queues just the beats it was handed', async () => {
    await seed();
    const provider = mockProvider();
    mockBeatAudio();
    mockScript();
    mockLink();
    mockPresenter();
    const { runShots } = await import('@/lib/reel/shots');

    const reel = await runShots('grok', ['b3']);

    expect(provider.animate).toHaveBeenCalledTimes(1);
    expect(reel.beats.find((b) => b.id === 'b3')!.shot.assetId).toBeTruthy();
    expect(reel.beats.find((b) => b.id === 'b2')!.shot.assetId).toBeFalsy();
  });

  it('still queues everything when handed nothing', async () => {
    await seed();
    const provider = mockProvider();
    mockBeatAudio();
    mockScript();
    mockLink();
    mockPresenter();
    const { runShots } = await import('@/lib/reel/shots');

    await runShots('grok');
    expect(provider.animate).toHaveBeenCalledTimes(2);
  });

  it('queues nothing at all for an empty selection', async () => {
    await seed();
    const provider = mockProvider();
    mockBeatAudio();
    mockScript();
    mockLink();
    mockPresenter();
    const { runShots } = await import('@/lib/reel/shots');

    await runShots('grok', []);
    expect(provider.animate).not.toHaveBeenCalled();
  });
});
