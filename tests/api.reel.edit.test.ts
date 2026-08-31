import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/** The contract an agent codes against: what a rejection says, and what it costs. */

beforeEach(async () => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-edit-api-'));
  (await import('@/lib/reel/bus')).resetBus();
});

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });

const post = (body: unknown) =>
  new Request('http://localhost/api/reel/grok/edit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const clip = (id: string, assetId: string, start: number, end: number) => ({
  id,
  assetId,
  start,
  end,
  srcIn: 0,
  fit: 'cover' as const,
  motion: { type: 'zoom-in' as const, strength: 0.12, origin: [0.5, 0.4] as [number, number] },
  transition: 'cut' as const,
  locked: false,
});

async function seed() {
  const { validateReel, emptyReel } = await import('@/lib/reel/schema');
  const { saveReel } = await import('@/lib/reel/store');
  const reel = validateReel({
    ...emptyReel('grok'),
    title: 'Grok',
    vo: { durationSec: 12 },
    assets: [{ id: 'a1', kind: 'video', path: 'assets/a1.mp4', origin: 'plugin', status: 'ready' }],
    timeline: {
      clips: [clip('c1', 'a1', 0, 4), clip('c2', 'a1', 4, 9)],
      captions: [{ id: 'k1', text: 'hello there', start: 0.5, end: 1.4 }],
      overlays: [],
    },
  });
  await saveReel('grok', reel);
  return reel;
}

describe('POST /api/reel/[slug]/edit', () => {
  it('applies a command and returns the reel with the history entry', async () => {
    const { POST } = await import('@/app/api/reel/[slug]/edit/route');
    await seed();

    const res = await POST(post({ op: 'clip.fit', args: { clipId: 'c1', fit: 'contain' } }), ctx('grok'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.reel.timeline.clips[0].fit).toBe('contain');
    expect(body.entry.summary).toMatch(/c1/);
  });

  it('defaults an unlabelled caller to the agent, since the studio always says so', async () => {
    const { POST } = await import('@/app/api/reel/[slug]/edit/route');
    await seed();

    const res = await POST(post({ op: 'clip.fit', args: { clipId: 'c1', fit: 'contain' } }), ctx('grok'));

    expect((await res.json()).entry.actor).toBe('agent');
  });

  it('keeps the actor the caller declared', async () => {
    const { POST } = await import('@/app/api/reel/[slug]/edit/route');
    await seed();

    const res = await POST(
      post({ op: 'clip.fit', args: { clipId: 'c1', fit: 'contain' }, actor: 'ui' }),
      ctx('grok')
    );

    expect((await res.json()).entry.actor).toBe('ui');
  });

  it('answers an unknown op with 400 and the list of real ops', async () => {
    const { POST } = await import('@/app/api/reel/[slug]/edit/route');
    await seed();

    const res = await POST(post({ op: 'clip.explode', args: {} }), ctx('grok'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.validOps).toContain('caption.nudge');
  });

  it('answers a bad id with 404 and the ids that exist', async () => {
    const { POST } = await import('@/app/api/reel/[slug]/edit/route');
    await seed();

    const res = await POST(post({ op: 'clip.delete', args: { clipId: 'nope' } }), ctx('grok'));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.validIds).toEqual(['c1', 'c2']);
  });

  it('answers malformed args with 400 and the schema they failed', async () => {
    const { POST } = await import('@/app/api/reel/[slug]/edit/route');
    await seed();

    const res = await POST(post({ op: 'clip.trim', args: { clipId: 'c1' } }), ctx('grok'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.schema).toBeDefined();
  });

  it('rejects a body that is not a command at all', async () => {
    const { POST } = await import('@/app/api/reel/[slug]/edit/route');
    await seed();

    const res = await POST(post({ nonsense: true }), ctx('grok'));

    expect(res.status).toBe(400);
  });
});

describe('/api/reel/[slug]/history', () => {
  it('returns an empty log for an unedited reel', async () => {
    const { GET } = await import('@/app/api/reel/[slug]/history/route');
    await seed();

    const body = await (await GET(new Request('http://localhost/h'), ctx('grok'))).json();

    expect(body).toEqual({ cursor: 0, entries: [] });
  });

  it('lists what was done, newest last, with the actor', async () => {
    const { POST: edit } = await import('@/app/api/reel/[slug]/edit/route');
    const { GET } = await import('@/app/api/reel/[slug]/history/route');
    await seed();

    await edit(post({ op: 'clip.fit', args: { clipId: 'c1', fit: 'contain' }, actor: 'ui' }), ctx('grok'));
    await edit(post({ op: 'caption.toggle', args: { cueId: 'k1' }, actor: 'agent' }), ctx('grok'));
    const body = await (await GET(new Request('http://localhost/h'), ctx('grok'))).json();

    expect(body.entries.map((e: { op: string }) => e.op)).toEqual(['clip.fit', 'caption.toggle']);
    expect(body.entries[1].actor).toBe('agent');
    expect(body.cursor).toBe(2);
  });

  it('undoes the last command and returns the restored reel', async () => {
    const { POST: edit } = await import('@/app/api/reel/[slug]/edit/route');
    const { POST } = await import('@/app/api/reel/[slug]/history/route');
    await seed();

    await edit(post({ op: 'clip.fit', args: { clipId: 'c1', fit: 'contain' } }), ctx('grok'));
    const res = await POST(
      new Request('http://localhost/h', { method: 'POST', body: JSON.stringify({ action: 'undo' }) }),
      ctx('grok')
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.reel.timeline.clips[0].fit).toBe('cover');
    expect(body.cursor).toBe(0);
  });

  it('redoes what it undid', async () => {
    const { POST: edit } = await import('@/app/api/reel/[slug]/edit/route');
    const { POST } = await import('@/app/api/reel/[slug]/history/route');
    await seed();
    const act = (action: string) =>
      POST(new Request('http://localhost/h', { method: 'POST', body: JSON.stringify({ action }) }), ctx('grok'));

    await edit(post({ op: 'clip.fit', args: { clipId: 'c1', fit: 'contain' } }), ctx('grok'));
    await act('undo');
    const body = await (await act('redo')).json();

    expect(body.reel.timeline.clips[0].fit).toBe('contain');
  });

  it('answers 409 when there is nothing left to undo', async () => {
    const { POST } = await import('@/app/api/reel/[slug]/history/route');
    await seed();

    const res = await POST(
      new Request('http://localhost/h', { method: 'POST', body: JSON.stringify({ action: 'undo' }) }),
      ctx('grok')
    );

    expect(res.status).toBe(409);
  });

  it('rejects an action that is neither undo nor redo', async () => {
    const { POST } = await import('@/app/api/reel/[slug]/history/route');
    await seed();

    const res = await POST(
      new Request('http://localhost/h', { method: 'POST', body: JSON.stringify({ action: 'rewind' }) }),
      ctx('grok')
    );

    expect(res.status).toBe(400);
  });

  it('broadcasts the restored reel so an open tab follows an undo', async () => {
    const { POST: edit } = await import('@/app/api/reel/[slug]/edit/route');
    const { POST } = await import('@/app/api/reel/[slug]/history/route');
    const { subscribe } = await import('@/lib/reel/bus');
    await seed();
    await edit(post({ op: 'clip.fit', args: { clipId: 'c1', fit: 'contain' } }), ctx('grok'));
    const seen: string[] = [];
    subscribe('grok', (r) => seen.push(r.timeline.clips[0].fit));

    await POST(
      new Request('http://localhost/h', { method: 'POST', body: JSON.stringify({ action: 'undo' }) }),
      ctx('grok')
    );

    expect(seen).toEqual(['cover']);
  });
});

describe('GET /api/reel/[slug]/events', () => {
  it('streams the reel to a subscriber when a command lands', async () => {
    const { GET } = await import('@/app/api/reel/[slug]/events/route');
    const { POST: edit } = await import('@/app/api/reel/[slug]/edit/route');
    await seed();

    const res = await GET(new Request('http://localhost/events'), ctx('grok'));
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);

    const reader = res.body!.getReader();
    await edit(post({ op: 'clip.fit', args: { clipId: 'c1', fit: 'contain' } }), ctx('grok'));

    const text = new TextDecoder().decode((await reader.read()).value);
    expect(text).toMatch(/^data: /m);
    expect(JSON.parse(text.replace(/^data: /, '').trim()).timeline.clips[0].fit).toBe('contain');

    await reader.cancel();
  });

  it('drops its subscription when the client disconnects', async () => {
    const { GET } = await import('@/app/api/reel/[slug]/events/route');
    const { subscriberCount } = await import('@/lib/reel/bus');
    await seed();

    const res = await GET(new Request('http://localhost/events'), ctx('grok'));
    const reader = res.body!.getReader();
    expect(subscriberCount('grok')).toBe(1);

    await reader.cancel();

    expect(subscriberCount('grok')).toBe(0);
  });
});
