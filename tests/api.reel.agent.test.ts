import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/** The contract the agent panel codes against. */

beforeEach(async () => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'reel-agent-api-'));
  (await import('@/lib/reel/bus')).resetBus();
  vi.unstubAllGlobals();
});

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });
const post = (body: unknown) =>
  new Request('http://localhost/x', {
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
    assets: [{ id: 'a1', kind: 'video', path: 'assets/a1.mp4', origin: 'comfy', status: 'ready' }],
    timeline: {
      clips: [clip('c1', 'a1', 0, 4), clip('c2', 'a1', 4, 9)],
      captions: [{ id: 'k1', text: 'hello there', start: 0.5, end: 1.4 }],
      overlays: [],
    },
  });
  await saveReel('grok', reel);
  return reel;
}

/** Answers as the LangGraph service would, without one running. */
function stubService(body: unknown, ok = true, status = 200) {
  vi.stubGlobal('fetch', () =>
    Promise.resolve({ ok, status, json: () => Promise.resolve(body) } as Response)
  );
}

describe('POST /api/reel/[slug]/preview', () => {
  it('returns the projected reel without touching the stored one', async () => {
    const { POST } = await import('@/app/api/reel/[slug]/preview/route');
    const { loadReel } = await import('@/lib/reel/store');
    const before = await seed();

    const res = await POST(post({ commands: [{ op: 'clip.fit', args: { clipId: 'c1', fit: 'contain' } }] }), ctx('grok'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.reel.timeline.clips[0].fit).toBe('contain');
    expect(body.applied).toHaveLength(1);
    expect(await loadReel('grok')).toEqual(before);
  });

  it('reports rejections instead of failing the request', async () => {
    const { POST } = await import('@/app/api/reel/[slug]/preview/route');
    await seed();

    const res = await POST(post({ commands: [{ op: 'clip.delete', args: { clipId: 'c99' } }] }), ctx('grok'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0].detail.validIds).toEqual(['c1', 'c2']);
  });

  it('rejects a body that is not a command list', async () => {
    const { POST } = await import('@/app/api/reel/[slug]/preview/route');
    await seed();

    expect((await POST(post({ commands: 'nope' }), ctx('grok'))).status).toBe(400);
  });
});

describe('POST /api/reel/[slug]/agent', () => {
  it('returns the agent proposal already previewed against the real reel', async () => {
    const { POST } = await import('@/app/api/reel/[slug]/agent/route');
    await seed();
    stubService({ commands: [{ op: 'clip.fit', args: { clipId: 'c1', fit: 'contain' } }] });

    const res = await POST(post({ prompt: 'letterbox the opener' }), ctx('grok'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.commands).toHaveLength(1);
    expect(body.reel.timeline.clips[0].fit).toBe('contain');
    expect(body.rejected).toEqual([]);
    expect(body.provider).toBe('local');
  });

  it('changes nothing on disk, since a proposal is not an edit', async () => {
    const { POST } = await import('@/app/api/reel/[slug]/agent/route');
    const { loadReel } = await import('@/lib/reel/store');
    const history = await import('@/lib/reel/history');
    const before = await seed();
    stubService({ commands: [{ op: 'clip.fit', args: { clipId: 'c1', fit: 'contain' } }] });

    await POST(post({ prompt: 'letterbox the opener' }), ctx('grok'));

    expect(await loadReel('grok')).toEqual(before);
    expect((await history.read('grok')).entries).toEqual([]);
  });

  it('surfaces rejections so a bad plan is visible rather than silently trimmed', async () => {
    const { POST } = await import('@/app/api/reel/[slug]/agent/route');
    await seed();
    stubService({ commands: [{ op: 'clip.delete', args: { clipId: 'c99' } }] });

    const body = await (await POST(post({ prompt: 'drop the third clip' }), ctx('grok'))).json();

    expect(body.rejected).toHaveLength(1);
    expect(body.applied).toEqual([]);
  });

  it('requires a prompt', async () => {
    const { POST } = await import('@/app/api/reel/[slug]/agent/route');
    await seed();

    expect((await POST(post({}), ctx('grok'))).status).toBe(400);
  });

  it('reports an unreachable agent service with the URL and how to start it', async () => {
    const { POST } = await import('@/app/api/reel/[slug]/agent/route');
    await seed();
    vi.stubGlobal('fetch', () => Promise.reject(new Error('ECONNREFUSED')));

    const res = await POST(post({ prompt: 'tighten it' }), ctx('grok'));
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error).toMatch(/3121/);
    expect(body.error).toMatch(/compose/);
  });
});

describe('POST /api/reel/[slug]/agent/apply', () => {
  it('applies the commands for real, as the agent', async () => {
    const { POST } = await import('@/app/api/reel/[slug]/agent/apply/route');
    const history = await import('@/lib/reel/history');
    await seed();

    const res = await POST(post({ commands: [{ op: 'clip.fit', args: { clipId: 'c1', fit: 'contain' } }] }), ctx('grok'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.reel.timeline.clips[0].fit).toBe('contain');
    const log = await history.read('grok');
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0].actor).toBe('agent');
  });

  it('applies a multi-command plan in order', async () => {
    const { POST } = await import('@/app/api/reel/[slug]/agent/apply/route');
    await seed();

    const body = await (
      await POST(
        post({
          commands: [
            { op: 'clip.split', args: { clipId: 'c1', atSec: 2 } },
            { op: 'clip.fit', args: { clipId: 'c1-b', fit: 'contain' } },
          ],
        }),
        ctx('grok')
      )
    ).json();

    expect(body.applied).toHaveLength(2);
    expect(body.reel.timeline.clips.find((c: { id: string }) => c.id === 'c1-b').fit).toBe('contain');
  });

  // Later commands in a plan depend on earlier ones, so a failure stops the run.
  it('stops at the first rejection and says what landed', async () => {
    const { POST } = await import('@/app/api/reel/[slug]/agent/apply/route');
    const { loadReel } = await import('@/lib/reel/store');
    await seed();

    const res = await POST(
      post({
        commands: [
          { op: 'clip.fit', args: { clipId: 'c1', fit: 'contain' } },
          { op: 'clip.delete', args: { clipId: 'c99' } },
          { op: 'caption.toggle', args: { cueId: 'k1' } },
        ],
      }),
      ctx('grok')
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.applied).toHaveLength(1);
    expect(body.rejected.index).toBe(1);
    expect(body.notAttempted).toBe(1);
    // What landed before the failure stays landed, and is undoable.
    expect((await loadReel('grok')).timeline.clips[0].fit).toBe('contain');
    expect((await loadReel('grok')).timeline.captions[0].hidden ?? false).toBe(false);
  });

  it('refuses an empty plan rather than recording a no-op', async () => {
    const { POST } = await import('@/app/api/reel/[slug]/agent/apply/route');
    await seed();

    expect((await POST(post({ commands: [] }), ctx('grok'))).status).toBe(400);
  });
});
