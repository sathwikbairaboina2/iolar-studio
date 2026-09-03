import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'pat-api-'));
  vi.resetModules();
});

describe('presenter upload', () => {
  it('stores the hook clip for a pattern reel and clears it again', async () => {
    const { createReel, loadReel } = await import('@/lib/reel/store');
    await createReel('t', { pattern: { name: 'tools', theme: 'kinetic' } } as never);
    const r = await import('@/app/api/reel/[slug]/presenter/route');
    const put = await r.PUT(new Request('http://x', { method: 'PUT', body: new Uint8Array([1, 2, 3]) }), ctx('t'));
    expect(put.status).toBe(200);
    expect((await loadReel('t')).pattern?.presenter).toBe('upload');
    expect(await (await r.GET(new Request('http://x?state'), ctx('t'))).json()).toMatchObject({ source: 'upload', status: 'ready' });
    expect((await r.PUT(new Request('http://x', { method: 'PUT', body: new Uint8Array() }), ctx('t'))).status).toBe(400);
    await r.DELETE(new Request('http://x'), ctx('t'));
    expect((await loadReel('t')).pattern?.presenter).toBe('lipsync');
  });
});
