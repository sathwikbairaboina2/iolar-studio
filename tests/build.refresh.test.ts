import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * Its own file: the shots suite mocks the provider registry several ways, and
 * `vi.doMock` registrations outlive a `resetModules`.
 */

beforeEach(() => {
  vi.resetModules();
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-refresh-'));
});

async function seedRunning(jobState: () => Promise<'running' | 'ready' | 'failed' | 'gone'>) {
  vi.doMock('@/lib/reel/videoProvider', async (orig) => ({
    ...(await (orig() as Promise<Record<string, unknown>>)),
    videoProvider: () => ({ name: 'webpage', available: async () => true, animate: vi.fn(), jobState, collect: vi.fn() }),
  }));

  const { createReel, loadReel, saveReel } = await import('@/lib/reel/store');
  await createReel('grok');
  const reel = await loadReel('grok');
  await saveReel('grok', {
    ...reel,
    assets: [
      { id: 'a1', kind: 'video', path: '', origin: 'plugin', provider: 'webpage', status: 'running', jobId: 'p-1', brief: '' },
    ],
  } as never);
}

describe('a job the renderer no longer has', () => {
  // Retrying for ever left the asset running, so the reel never reported itself
  // stuck and nothing ever re-queued the beat.
  it('fails the asset so the reel can report it and retry', async () => {
    await seedRunning(async () => 'gone');
    const { refreshShots } = await import('@/lib/reel/shots');

    const after = await refreshShots('grok');
    expect(after.assets[0].status).toBe('failed');
    expect(after.assets[0].error).toMatch(/no longer knows/);
  });

  // A renderer that is merely unreachable will have the job when it comes back.
  it('leaves it running when the renderer cannot be reached at all', async () => {
    await seedRunning(() => Promise.reject(new Error('fetch failed')));
    const { refreshShots } = await import('@/lib/reel/shots');

    expect((await refreshShots('grok')).assets[0].status).toBe('running');
  });
});
