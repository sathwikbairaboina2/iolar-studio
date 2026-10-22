import { mkdtempSync } from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { writeReference, readReference } from '@/lib/launch/inbox';

const maybeRunWatch = vi.fn(async () => false);
const runWatch = vi.fn(async () => ({ checked: 0, launches: 0, added: [], skipped: null }));
const watchRunning = vi.fn(async () => false);

vi.mock('@/lib/launch/watch', () => ({
  maybeRunWatch: (...a: unknown[]) => (maybeRunWatch as (...x: unknown[]) => unknown)(...a),
  runWatch: (...a: unknown[]) => (runWatch as (...x: unknown[]) => unknown)(...a),
  watchRunning: (...a: unknown[]) => (watchRunning as (...x: unknown[]) => unknown)(...a),
  realWatchDeps: async () => ({}),
}));

const ref = (id: string) => ({ id, creator: 'varunmayya', postedAt: '2026-10-21T08:00:00Z', url: `https://instagram.com/reel/${id}`, caption: 'c', topic: 'Gemini 4 launch', transcript: '', durationSec: 40,
  shots: [{ start: 0, end: 2.5, kind: 'talk' as const }], status: 'new' as const, foundAt: '2026-10-21T09:00:00Z' });
const patch = (body: unknown) => new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'launch-inbox-api-'));
  maybeRunWatch.mockClear();
  runWatch.mockClear();
  watchRunning.mockReset();
  watchRunning.mockResolvedValue(false);
});

describe('/api/launch/inbox', () => {
  it('lists references with the watch state and nudges the daily run', async () => {
    await writeReference(ref('AAAAA1'));
    const { GET } = await import('@/app/api/launch/inbox/route');
    const body = await (await GET()).json();
    expect(body.references.map((r: { id: string }) => r.id)).toEqual(['AAAAA1']);
    expect(body.watch).toMatchObject({ seen: [], running: false });
    expect(maybeRunWatch).toHaveBeenCalled();
  });
  it('dismisses a reference, and refuses an unknown status or a bad id', async () => {
    await writeReference(ref('AAAAA1'));
    const { PATCH } = await import('@/app/api/launch/inbox/[id]/route');
    expect((await PATCH(patch({ status: 'dismissed' }), ctx('AAAAA1'))).status).toBe(200);
    expect((await readReference('AAAAA1'))?.status).toBe('dismissed');
    expect((await PATCH(patch({ status: 'made' }), ctx('AAAAA1'))).status).toBe(400);
    expect((await PATCH(patch({ status: 'bogus' }), ctx('AAAAA1'))).status).toBe(400);
    expect((await PATCH(patch({ status: 'dismissed' }), ctx('../x'))).status).toBe(400);
    expect((await PATCH(patch({ status: 'dismissed' }), ctx('ZZZZZ9'))).status).toBe(404);
  });
  it('starts a check now with 202, or 409 when one is running', async () => {
    const { POST } = await import('@/app/api/launch/inbox/watch/route');
    expect((await POST()).status).toBe(202);
    await vi.waitFor(() => expect(runWatch).toHaveBeenCalled());
    watchRunning.mockResolvedValue(true);
    expect((await POST()).status).toBe(409);
  });
});
