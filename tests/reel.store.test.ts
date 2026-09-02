import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-store-'));
});

describe('reel store', () => {
  it('creates a reel and lists it', async () => {
    const { createReel, listReels } = await import('@/lib/reel/store');
    await createReel('grok-bot', { title: 'xAI drops Grok Bot' });
    const list = await listReels();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ slug: 'grok-bot', title: 'xAI drops Grok Bot', status: 'draft', beats: 1 });
  });

  it('round-trips through save and validates on the way in', async () => {
    const { createReel, loadReel, saveReel } = await import('@/lib/reel/store');
    const reel = await createReel('grok-bot');
    await saveReel('grok-bot', { ...reel, seed: 7 });
    expect((await loadReel('grok-bot')).seed).toBe(7);
    await expect(saveReel('grok-bot', { ...reel, fps: 5 } as never)).rejects.toThrow();
  });

  it('appends assets with generated ids and patches their status', async () => {
    const { createReel, addAsset, updateAsset, loadReel } = await import('@/lib/reel/store');
    await createReel('grok-bot');
    const a = await addAsset('grok-bot', { kind: 'video', path: 'assets/a1.mp4', origin: 'plugin', brief: 'chat UI' });
    expect(a.id).toMatch(/^a\d+$/);
    await updateAsset('grok-bot', a.id, { status: 'ready', durationSec: 5 });
    const reel = await loadReel('grok-bot');
    expect(reel.assets[0]).toMatchObject({ status: 'ready', durationSec: 5 });
  });

  it('reports status from what exists', async () => {
    const { createReel, loadReel, saveReel, reelStatus } = await import('@/lib/reel/store');
    await createReel('grok-bot');
    let reel = await loadReel('grok-bot');
    expect(reelStatus(reel)).toBe('draft');
    reel = { ...reel, vo: { ...reel.vo, words: [{ w: 'hi', start: 0, end: 0.2 }], durationSec: 1 } };
    expect(reelStatus(reel)).toBe('voiced');
    reel = {
      ...reel,
      timeline: {
        ...reel.timeline,
        clips: [
          {
            id: 'c1', assetId: 'a1', start: 0, end: 1, srcIn: 0, fit: 'cover',
            motion: { type: 'hold', strength: 0, origin: [0.5, 0.5] },
            transition: 'cut', locked: false,
          },
        ],
      },
    };
    await saveReel('grok-bot', reel);
    expect(reelStatus(await loadReel('grok-bot'))).toBe('assembled');
  });

  it('deletes a reel folder', async () => {
    const { createReel, deleteReel, listReels } = await import('@/lib/reel/store');
    await createReel('grok-bot');
    await deleteReel('grok-bot');
    expect(await listReels()).toEqual([]);
  });

  it('skips a broken reel folder instead of failing the whole list', async () => {
    const { createReel, listReels } = await import('@/lib/reel/store');
    const { mkdirSync, writeFileSync } = await import('fs');
    await createReel('good');
    const bad = path.join(process.env.IOLAR_DATA_DIR!, 'reel', 'broken');
    mkdirSync(bad, { recursive: true });
    writeFileSync(path.join(bad, 'reel.json'), '{ not json');
    expect((await listReels()).map((r) => r.slug)).toEqual(['good']);
  });
});

describe('saving a reel touches no store', () => {
  it('writes nothing to the graph when a reel is saved; research writes through lib/knowledge, saveReel never', async () => {
    const { createReel, loadReel, saveReel } = await import('@/lib/reel/store');
    const { FakeGraph, FakeVectors, FakeEmbed } = await import('@/lib/knowledge/fake');
    const { useStoresForTests } = await import('@/lib/knowledge/stores');
    const fake = new FakeGraph();
    useStoresForTests({ graph: fake, vectors: new FakeVectors(), embed: new FakeEmbed() });
    await createReel('grok-bot', { title: 'xAI drops Grok Bot' });
    const reel = await loadReel('grok-bot');
    await saveReel('grok-bot', {
      ...reel,
      beats: [{ id: 'b1', role: 'hook', text: 'Grok Bot ships today', shot: { kind: 'title', brief: '', hero: false , alsoAssetIds: [], sourceLineId: null } }],
    });
    expect(fake.nodes.size).toBe(0);
    expect(fake.edges.size).toBe(0);
  });
});
