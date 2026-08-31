import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-api-'));
});

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });
const post = (body: unknown) =>
  new Request('http://x/api/reel', { method: 'POST', body: JSON.stringify(body) });

describe('reel api', () => {
  it('creates a reel from a title and lists it', async () => {
    const { POST, GET } = await import('@/app/api/reel/route');
    const res = await POST(post({ title: 'xAI drops Grok Bot' }));
    expect(res.status).toBe(200);
    expect((await res.json()).slug).toBe('xai-drops-grok-bot');
    const list = await (await GET()).json();
    expect(list.reels).toHaveLength(1);
    expect(list.reels[0]).toMatchObject({ title: 'xAI drops Grok Bot', status: 'draft' });
  });

  it('rejects a duplicate slug and a nameless reel', async () => {
    const { POST } = await import('@/app/api/reel/route');
    expect((await POST(post({ title: 'Dup' }))).status).toBe(200);
    expect((await POST(post({ title: 'Dup' }))).status).toBe(409);
    expect((await POST(post({}))).status).toBe(400);
  });

  it('gets, saves and deletes one reel', async () => {
    const { POST } = await import('@/app/api/reel/route');
    await POST(post({ title: 'Grok' }));
    const one = await import('@/app/api/reel/[slug]/route');

    const got = await (await one.GET(new Request('http://x'), ctx('grok'))).json();
    expect(got.reel.title).toBe('Grok');

    const put = await one.PUT(
      new Request('http://x', { method: 'PUT', body: JSON.stringify({ reel: { ...got.reel, seed: 9 } }) }),
      ctx('grok')
    );
    expect(put.status).toBe(200);
    expect((await (await one.GET(new Request('http://x'), ctx('grok'))).json()).reel.seed).toBe(9);

    expect((await one.DELETE(new Request('http://x'), ctx('grok'))).status).toBe(200);
    expect((await one.GET(new Request('http://x'), ctx('grok'))).status).toBe(404);
  });

  it('rejects an invalid reel on save with 400, not 500', async () => {
    const { POST } = await import('@/app/api/reel/route');
    await POST(post({ title: 'Grok' }));
    const one = await import('@/app/api/reel/[slug]/route');
    const res = await one.PUT(
      new Request('http://x', { method: 'PUT', body: JSON.stringify({ reel: { title: 'no beats', beats: [] } }) }),
      ctx('grok')
    );
    expect(res.status).toBe(400);
  });

  it('lists patterns', async () => {
    const { GET } = await import('@/app/api/reel/patterns/route');
    const out = await (await GET(new Request('http://x/api/reel/patterns'))).json();
    expect(out.patterns.map((p: { name: string }) => p.name)).toContain('armand');
  });
});

describe('assemble route', () => {
  const seed = async () => {
    const { createReel, loadReel, saveReel } = await import('@/lib/reel/store');
    await createReel('grok');
    const reel = await loadReel('grok');
    await saveReel('grok', {
      ...reel,
      beats: [
        { id: 'b1', role: 'hook', text: 'one two', shot: { kind: 'broll', brief: '', hero: false, assetId: 'a1' , alsoAssetIds: [] } },
        { id: 'b2', role: 'close', text: 'three four', shot: { kind: 'broll', brief: '', hero: false, assetId: 'a2' , alsoAssetIds: [] } },
      ],
      vo: { ...reel.vo, durationSec: 4, words: ['one', 'two', 'three', 'four'].map((w, i) => ({ w, start: i, end: i + 0.8 })) },
      assets: [
        { id: 'a1', kind: 'video', path: 'assets/a1.mp4', origin: 'plugin', status: 'ready', brief: '' },
        { id: 'a2', kind: 'video', path: 'assets/a2.mp4', origin: 'plugin', status: 'ready', brief: '' },
      ],
    });
  };

  it('builds clips and captions from the stored words', async () => {
    await seed();
    const { POST } = await import('@/app/api/reel/[slug]/assemble/route');
    const res = await POST(new Request('http://x', { method: 'POST' }), ctx('grok'));
    expect(res.status).toBe(200);
    const { reel } = await res.json();
    expect(reel.timeline.clips).toHaveLength(2);
    expect(reel.timeline.captions.length).toBeGreaterThan(0);

    const { loadReel } = await import('@/lib/reel/store');
    expect((await loadReel('grok')).timeline.clips).toHaveLength(2);
  });

  it('leaves a locked clip untouched on re-assembly', async () => {
    await seed();
    const { POST } = await import('@/app/api/reel/[slug]/assemble/route');
    await POST(new Request('http://x', { method: 'POST' }), ctx('grok'));

    const { loadReel, saveReel } = await import('@/lib/reel/store');
    const reel = await loadReel('grok');
    const locked = { ...reel.timeline.clips[0], end: reel.timeline.clips[0].end + 0.5, locked: true };
    await saveReel('grok', {
      ...reel,
      timeline: { ...reel.timeline, clips: [locked, ...reel.timeline.clips.slice(1)] },
    });

    await POST(new Request('http://x', { method: 'POST' }), ctx('grok'));
    const after = await loadReel('grok');
    expect(after.timeline.clips.find((c) => c.id === locked.id)).toEqual(locked);
  });
});
