import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * One board across every reel.
 *
 * The reel files already say which beat asked for a shot and what came back, so the board is
 * a join over them rather than a second source of truth — reading the plugins' own job lists
 * would surface jobs the studio has already moved past.
 */

beforeEach(() => {
  vi.resetModules();
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-board-'));
});

async function seed(slug: string, over: Record<string, unknown>) {
  const { createReel, loadReel, saveReel } = await import('@/lib/reel/store');
  await createReel(slug);
  const reel = await loadReel(slug);
  await saveReel(slug, { ...reel, ...over } as never);
}

const beat = (id: string, kind: string, assetId?: string) => ({
  id,
  role: 'body',
  text: `${id} says something`,
  shot: { kind, brief: '', hero: false, alsoAssetIds: [], sourceLineId: null, ...(assetId ? { assetId } : {}) },
});

describe('the job board', () => {
  it('joins every plugin render to the beat that asked for it', async () => {
    await seed('one', {
      title: 'Reel One',
      beats: [beat('b1', 'talking-head', 'a1'), beat('b2', 'screen', 'a2')],
      assets: [
        { id: 'a1', kind: 'video', path: 'assets/a1.mp4', origin: 'plugin', status: 'ready', provider: 'lipsync', brief: '', durationSec: 1.5 },
        { id: 'a2', kind: 'video', path: '', origin: 'plugin', status: 'running', provider: 'webpage', jobId: 'p-9', brief: '' },
      ],
    });
    const { readJobs } = await import('@/lib/plugins/jobs');

    const board = await readJobs();

    // Running first: the page is read from the top when something is on the GPU.
    expect(board.rows[0]).toMatchObject({ beatId: 'b2', plugin: 'webpage', status: 'running', jobId: 'p-9' });
    expect(board.rows[1]).toMatchObject({ beatId: 'b1', plugin: 'lipsync', status: 'ready', durationSec: 1.5 });
    expect(board.rows[0].reel).toBe('Reel One');
    expect(board.counts).toMatchObject({ running: 1, ready: 1 });
  });

  it('gathers reels together rather than making you open each one', async () => {
    await seed('one', { title: 'One', beats: [beat('b1', 'talking-head', 'a1')], assets: [{ id: 'a1', kind: 'video', path: '', origin: 'plugin', status: 'queued', provider: 'lipsync', brief: '' }] });
    await seed('two', { title: 'Two', beats: [beat('b1', 'screen', 'a1')], assets: [{ id: 'a1', kind: 'video', path: '', origin: 'plugin', status: 'failed', provider: 'webpage', error: 'boom', brief: '' }] });
    const { readJobs } = await import('@/lib/plugins/jobs');

    const board = await readJobs();
    expect(board.rows.map((r) => r.reel).sort()).toEqual(['One', 'Two']);
    expect(board.rows.find((r) => r.reel === 'Two')!.error).toBe('boom');
  });

  it('leaves a dropped file out of the render list', async () => {
    await seed('one', {
      title: 'One',
      beats: [beat('b1', 'talking-head', 'a1')],
      assets: [{ id: 'a1', kind: 'video', path: 'assets/a1.mp4', origin: 'user', status: 'ready', brief: '' }],
    });
    const { readJobs } = await import('@/lib/plugins/jobs');
    // Nothing rendered it, so it is not a render.
    expect((await readJobs()).rows).toHaveLength(0);
  });

  it('says what is waiting on a person and why', async () => {
    await seed('one', {
      title: 'One',
      beats: [beat('b1', 'talking-head', 'a1'), beat('b2', 'screen'), beat('b3', 'title')],
      assets: [{ id: 'a1', kind: 'video', path: '', origin: 'plugin', status: 'awaiting-manual', provider: 'lipsync', error: 'No presenter image is set', brief: '' }],
    });
    const { readJobs } = await import('@/lib/plugins/jobs');

    const board = await readJobs();
    expect(board.blocked).toEqual([
      expect.objectContaining({ beatId: 'b1', why: 'No presenter image is set' }),
      expect.objectContaining({ beatId: 'b2', why: expect.stringMatching(/never queued/) }),
    ]);
    // A title card is an overlay. It is not waiting on anybody.
    expect(board.blocked.some((b) => b.beatId === 'b3')).toBe(false);
  });
});
