import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let root: string;
const put = (rel: string, v: unknown) => { const f = path.join(root, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(v)); };
const post = (text: string) => ({ brand: 'iolar', series: 's', date: 'd', slides: [{ page_title: 'Page', blocks: [{ type: 'paragraph', text }] }] });
const ctx = { params: Promise.resolve({ subject: 'py' }) };
const req = (method: string, body?: unknown) => new Request('http://t/api', { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => {
  vi.resetModules();
  root = mkdtempSync(path.join(tmpdir(), 'api-pub-'));
  process.env.IOLAR_DATA_DIR = root;
  put('handbooks/py/subject.json', { slug: 'py', name: 'Python', emoji: 'x', description: 'd' });
  for (const [i, c] of ['loop', 'tasks'].entries()) {
    put(`handbooks/py/${c}/chapter.json`, { title: c, order: i });
    put(`handbooks/py/${c}/book.json`, { title: c, summary: 's', chapters: [{ title: 'a', points: ['p'] }] });
    put(`handbooks/py/${c}/parts/01/post.json`, post(c));
  }
});

describe('publish api', () => {
  it('answers 404 when approving an unknown chapter', async () => {
    const route = await import('@/app/api/handbooks/[subject]/publish/route');
    const res = await route.POST(req('POST', { action: 'approve', chapter: 'ghost' }), ctx);
    expect(res.status).toBe(404);
  });

  it('answers 400 for an order that puts a prerequisite after its chapter', async () => {
    put('handbooks/py/publish.json', {
      alwaysAsk: false,
      chapters: { loop: { selected: true, verdict: 'pass' }, tasks: { selected: true, verdict: 'pass' } },
      order: { order: ['loop', 'tasks'], prerequisites: { tasks: ['loop'] }, gaps: [], overlaps: [], confidence: 0.5, basis: 'b' },
    });
    const route = await import('@/app/api/handbooks/[subject]/publish/route');
    const res = await route.POST(req('POST', { action: 'order', order: ['tasks', 'loop'] }), ctx);
    expect(res.status).toBe(400);
  });

  it('approves a chapter and the order, then exports', async () => {
    const { chapterHash } = await import('@/lib/publish/hash');
    const { editionHash } = await import('@/lib/digital/edition');
    const hash = await chapterHash('py', 'loop');
    const sections = [{ title: 'Intro', role: 'intro', pages: [{ title: 'a', blocks: [{ type: 'paragraph', text: 'x' }] }] }];
    put('handbooks/py/loop/digital/edition.json', { schema: 1, subject: 'py', chapter: 'loop', inputsHash: hash, generatedAt: '2026-10-09T00:00:00.000Z', sections });
    put('handbooks/py/publish.json', {
      alwaysAsk: false,
      chapters: { loop: { selected: true, verdict: 'unsure', hash, editionHash: editionHash({ sections } as never), reviewedAt: '2026-10-09T00:00:00.000Z' } },
      order: { order: ['loop'], prerequisites: {}, gaps: [], overlaps: [], confidence: 0.5, basis: 'b' },
    });
    const route = await import('@/app/api/handbooks/[subject]/publish/route');
    const got = await (await route.GET(req('GET'), ctx)).json();
    expect(got.queue).toEqual({ chapters: ['loop'], order: true });
    expect((await route.POST(req('POST', { action: 'approve', chapter: 'loop' }), ctx)).status).toBe(200);
    expect((await route.POST(req('POST', { action: 'order', order: ['loop'] }), ctx)).status).toBe(200);
    const after = await (await route.GET(req('GET'), ctx)).json();
    expect(after.live).toEqual(['loop']);
    expect(after.queue).toEqual({ chapters: [], order: false });
  });

  it('answers 409 while a run is live', async () => {
    put('handbooks/py/publish-job.json', { subject: 'py', live: true, startedAt: new Date().toISOString(), stage: 'reviews', steps: [] });
    const route = await import('@/app/api/handbooks/[subject]/publish/route');
    expect((await route.POST(req('POST', { action: 'run', chapters: ['loop'] }), ctx)).status).toBe(409);
  });

  it('rejects a bad slug and unknown actions', async () => {
    const route = await import('@/app/api/handbooks/[subject]/publish/route');
    expect((await route.POST(req('POST', { action: 'run', chapters: ['Bad Slug'] }), ctx)).status).toBe(400);
    expect((await route.POST(req('POST', { action: 'dance' }), ctx)).status).toBe(400);
  });

  it('regenerate: 404 for an unknown chapter, 400 without notes, 409 while a run is live', async () => {
    const route = await import('@/app/api/handbooks/[subject]/publish/route');
    expect((await route.POST(req('POST', { action: 'regenerate', chapter: 'ghost', notes: 'x' }), ctx)).status).toBe(404);
    expect((await route.POST(req('POST', { action: 'regenerate', chapter: 'loop', notes: '  ' }), ctx)).status).toBe(400);
    put('handbooks/py/publish-job.json', { subject: 'py', live: true, startedAt: new Date().toISOString(), stage: 'reviews', steps: [] });
    expect((await route.POST(req('POST', { action: 'regenerate', chapter: 'loop', notes: 'more examples' }), ctx)).status).toBe(409);
  });

  it('regenerate starts a run for that chapter with the notes', async () => {
    const startPublish = vi.fn().mockResolvedValue({ subject: 'py', live: true, steps: [] });
    vi.doMock('@/lib/publish/job', async (orig) => ({ ...(await orig<object>()), startPublish }));
    const route = await import('@/app/api/handbooks/[subject]/publish/route');
    const res = await route.POST(req('POST', { action: 'regenerate', chapter: 'loop', notes: ' more examples ' }), ctx);
    expect(res.status).toBe(200);
    expect(startPublish).toHaveBeenCalledWith('py', ['loop'], { notes: { loop: 'more examples' } });
    vi.doUnmock('@/lib/publish/job');
  });

  it('lists the section title of every edition page and marks a swapped edition stale', async () => {
    const { chapterHash } = await import('@/lib/publish/hash');
    const { editionHash } = await import('@/lib/digital/edition');
    const sections = [
      { title: 'Intro', role: 'intro', pages: [{ title: 'a', blocks: [{ type: 'paragraph', text: 'x' }] }] },
      { title: 'Main', role: 'outline', outlineIndex: 0, pages: [{ title: 'b', blocks: [{ type: 'paragraph', text: 'y' }] }, { title: 'c', blocks: [{ type: 'paragraph', text: 'z' }] }] },
    ];
    put('handbooks/py/loop/digital/edition.json', { schema: 1, subject: 'py', chapter: 'loop', inputsHash: await chapterHash('py', 'loop'), generatedAt: 'now', sections });
    put('handbooks/py/publish.json', { alwaysAsk: false, chapters: { loop: { selected: true, verdict: 'pass', approvedBy: 'ai', hash: await chapterHash('py', 'loop'), editionHash: editionHash({ sections } as never) } } });
    const route = await import('@/app/api/handbooks/[subject]/publish/route');
    const got = await (await route.GET(req('GET'), ctx)).json();
    expect(got.editions.loop).toEqual(['Intro', 'Main', 'Main']);
    expect(got.stale).toEqual([]);
    expect(got.live).toEqual(['loop']);
    put('handbooks/py/loop/digital/edition.json', { schema: 1, subject: 'py', chapter: 'loop', inputsHash: await chapterHash('py', 'loop'), generatedAt: 'now', sections: [sections[0]] });
    const after = await (await route.GET(req('GET'), ctx)).json();
    expect(after.stale).toEqual(['loop']);
    expect(after.live).toEqual([]);
  });

  it('counts a chapter as live only when export would include it', async () => {
    const { chapterHash } = await import('@/lib/publish/hash');
    const { editionHash } = await import('@/lib/digital/edition');
    const sections = [{ title: 'Intro', role: 'intro', pages: [{ title: 'a', blocks: [{ type: 'paragraph', text: 'x' }] }] }];
    const hash = await chapterHash('py', 'loop');
    // reviewed and approved, but the edition was written from older inputs, so the export leaves it out
    put('handbooks/py/loop/digital/edition.json', { schema: 1, subject: 'py', chapter: 'loop', inputsHash: 'older', generatedAt: 'now', sections });
    put('handbooks/py/publish.json', { alwaysAsk: false, chapters: { loop: { selected: true, verdict: 'pass', approvedBy: 'ai', hash, editionHash: editionHash({ sections } as never) } } });
    const route = await import('@/app/api/handbooks/[subject]/publish/route');
    const got = await (await route.GET(req('GET'), ctx)).json();
    expect(got.live).toEqual([]);
    expect(got.stale).toEqual(['loop']);
  });

  it('rereview: 404 for an unknown chapter, 400 without an edition, 409 while a run is live, else starts a job', async () => {
    const route = await import('@/app/api/handbooks/[subject]/publish/route');
    expect((await route.POST(req('POST', { action: 'rereview', chapter: 'ghost' }), ctx)).status).toBe(404);
    expect((await route.POST(req('POST', { action: 'rereview', chapter: 7 }), ctx)).status).toBe(400);
    expect((await route.POST(req('POST', { action: 'rereview', chapter: 'loop' }), ctx)).status).toBe(400);
    put('handbooks/py/loop/digital/edition.json', { schema: 1, subject: 'py', chapter: 'loop', inputsHash: 'h', generatedAt: 'now', sections: [] });
    put('handbooks/py/publish-job.json', { subject: 'py', live: true, startedAt: new Date().toISOString(), stage: 'reviews', steps: [] });
    expect((await route.POST(req('POST', { action: 'rereview', chapter: 'loop' }), ctx)).status).toBe(409);
    vi.resetModules();
    const startPublish = vi.fn().mockResolvedValue({ subject: 'py', live: true });
    vi.doMock('@/lib/publish/job', async (orig) => ({ ...(await orig<object>()), startPublish }));
    const mocked = await import('@/app/api/handbooks/[subject]/publish/route');
    expect((await mocked.POST(req('POST', { action: 'rereview', chapter: 'loop' }), ctx)).status).toBe(200);
    expect(startPublish).toHaveBeenCalledWith('py', ['loop'], { rereview: true });
    vi.doUnmock('@/lib/publish/job');
  });
});
