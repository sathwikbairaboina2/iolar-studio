import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { seedPatternReel, templatesReply, good } from './helpers/pattern';

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });

const templatesFetch = (async (url: string) => {
  if (String(url).endsWith('/templates')) return { ok: true, status: 200, json: async () => templatesReply } as Response;
  if (String(url).endsWith('/validate')) return { ok: true, status: 200, json: async () => ({}) } as Response;
  return { ok: false, status: 404, json: async () => ({}) } as Response;
}) as unknown as typeof fetch;

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'pat-api-'));
  vi.resetModules();
  vi.stubGlobal('fetch', templatesFetch);
});

describe('pattern routes', () => {
  it('creates a pattern reel and lists available patterns', async () => {
    const { POST } = await import('@/app/api/reel/route');
    const res = await POST(new Request('http://x/api/reel', { method: 'POST', body: JSON.stringify({ title: 'Tools week', pattern: { name: 'tools', theme: 'kinetic' } }) }));
    expect((await res.json()).reel.pattern).toMatchObject({ name: 'tools', theme: 'kinetic', presenter: 'lipsync' });
    const bad = await POST(new Request('http://x/api/reel', { method: 'POST', body: JSON.stringify({ title: 'No theme', pattern: { name: 'tools' } }) }));
    expect(bad.status).toBe(400);
    const list = await (await (await import('@/app/api/reel/patterns/route')).GET()).json();
    expect(list.patterns.map((p: { name: string }) => p.name)).toEqual(['tools']);
  });

  it('reports state with lines and limits, takes section edits, and refuses bad ones with the path', async () => {
    await seedPatternReel({ sections: true });
    const r = await import('@/app/api/reel/[slug]/pattern/route');
    const state = await (await r.GET(new Request('http://x'), ctx('t'))).json();
    expect(state.stage).toBe('sectioned');
    expect(state.units).toHaveLength(5);
    expect(state.lines.l1).toContain('Three tools');
    expect(state.limits.title).toBe(60);
    expect(state.themes).toContain('kinetic');
    const edited = structuredClone(good);
    (edited[0] as { title: string }).title = 'Three tools, one afternoon';
    const ok = await r.POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ sections: edited, theme: 'glass-bento' }) }), ctx('t'));
    expect(ok.status).toBe(200);
    expect((await ok.json()).pattern.theme).toBe('glass-bento');
    const bad = structuredClone(good);
    (bad[0] as { title: string }).title = '';
    const rej = await r.POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ sections: bad }) }), ctx('t'));
    expect(rej.status).toBe(400);
    expect((await rej.json()).path).toBe('sections.0.title');
  });

  it('advances with a message on refusal, and renders with 422 issues mapped', async () => {
    await seedPatternReel({ sections: true });
    const adv = await import('@/app/api/reel/[slug]/pattern/advance/route');
    const res = await adv.POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ voice: 'supplied' }) }), ctx('t'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/upload/);

    vi.stubGlobal('fetch', (async (url: string) => {
      if (String(url).endsWith('/templates')) return { ok: true, status: 200, json: async () => templatesReply } as Response;
      return { ok: false, status: 422, json: async () => ({ detail: [{ loc: ['body', 'sections', 3, 'cta', 'keyword'], msg: 'too long', type: 'x' }] }) } as Response;
    }) as unknown as typeof fetch);
    const { reelPresenterFile } = await import('@/lib/paths');
    await seedPatternReel({ sections: true, voice: true, words: true });
    writeFileSync(reelPresenterFile('t'), 'mp4');
    const render = await import('@/app/api/reel/[slug]/pattern/render/route');
    const rr = await render.POST(new Request('http://x', { method: 'POST', body: '{}' }), ctx('t'));
    expect(rr.status).toBe(422);
    expect((await rr.json()).issues[0].loc).toEqual(['sections', 3, 'cta', 'keyword']);
  });

  it('runs the section stage through its route and reports an unapproved script as 409', async () => {
    await seedPatternReel({ approved: false });
    const sec = await import('@/app/api/reel/[slug]/pattern/section/route');
    const res = await sec.POST(new Request('http://x', { method: 'POST' }), ctx('t'));
    expect(res.status).toBe(409);
  });
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
