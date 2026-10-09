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
    put('handbooks/py/publish.json', {
      alwaysAsk: false,
      chapters: { loop: { selected: true, verdict: 'unsure', hash: await chapterHash('py', 'loop'), reviewedAt: '2026-10-09T00:00:00.000Z' } },
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
});
