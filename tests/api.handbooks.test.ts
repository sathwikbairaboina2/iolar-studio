import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const req = (method: string, body?: unknown) =>
  new Request('http://t/api', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'is-api-'));
});

describe('handbooks api', () => {
  it('creates subject, chapter, reads and saves the part', async () => {
    const subjects = await import('@/app/api/handbooks/route');
    const chapters = await import('@/app/api/handbooks/[subject]/route');
    const part = await import('@/app/api/handbooks/[subject]/[chapter]/parts/[part]/route');

    await subjects.POST(req('POST', { slug: 'python', name: 'Python', emoji: '🐍' }));
    expect((await (await subjects.GET()).json()).subjects[0].slug).toBe('python');

    await chapters.POST(req('POST', { slug: 'lists', title: 'Python Lists' }), {
      params: Promise.resolve({ subject: 'python' }),
    });
    const list = await (await chapters.GET(req('GET'), { params: Promise.resolve({ subject: 'python' }) })).json();
    expect(list.chapters[0]).toMatchObject({ slug: 'lists', parts: 1 });

    const ctx = { params: Promise.resolve({ subject: 'python', chapter: 'lists', part: '1' }) };
    const got = await (await part.GET(req('GET'), ctx)).json();
    got.series = 'UPDATED';
    const saved = await (await part.PUT(req('PUT', got), ctx)).json();
    expect(saved.series).toBe('UPDATED');
  });

  it('rejects a bad subject slug', async () => {
    const subjects = await import('@/app/api/handbooks/route');
    expect((await subjects.POST(req('POST', { slug: 'Bad Slug!' }))).status).toBe(400);
  });

  it('saves and reads chapter references', async () => {
    const subjects = await import('@/app/api/handbooks/route');
    const chapters = await import('@/app/api/handbooks/[subject]/route');
    const refs = await import('@/app/api/handbooks/[subject]/[chapter]/references/route');
    await subjects.POST(req('POST', { slug: 'python' }));
    await chapters.POST(req('POST', { slug: 'lists' }), { params: Promise.resolve({ subject: 'python' }) });

    const ctx = { params: Promise.resolve({ subject: 'python', chapter: 'lists' }) };
    const put = await refs.PUT(req('PUT', { urls: ['http://x/1', 'garbage', ' http://x/2 '] }), ctx);
    expect((await put.json()).urls).toEqual(['http://x/1', 'http://x/2']);
    expect((await (await refs.GET(req('GET'), ctx)).json()).urls).toHaveLength(2);
  });

  it('renders a part and reports the page count', async () => {
    const subjects = await import('@/app/api/handbooks/route');
    const chapters = await import('@/app/api/handbooks/[subject]/route');
    const render = await import('@/app/api/handbooks/[subject]/[chapter]/parts/[part]/render/route');
    await subjects.POST(req('POST', { slug: 'python' }));
    await chapters.POST(req('POST', { slug: 'lists' }), { params: Promise.resolve({ subject: 'python' }) });

    const ctx = { params: Promise.resolve({ subject: 'python', chapter: 'lists', part: '1' }) };
    const body = await (await render.POST(req('POST', {}), ctx)).json();
    expect(body.results[0].overflowPx).toBe(0);
    expect(existsSync(body.results[0].file)).toBe(true);
    expect(body.followUp).toBeNull();
  }, 120_000);
});
