import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

function req(method: string, body?: unknown) {
  return new Request('http://test.local/api', {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

describe('paperbook api', () => {
  beforeEach(() => {
    process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'iolar-api-'));
  });

  it('create -> list -> get -> put roundtrip', async () => {
    const list = await import('@/app/api/paperbook/route');
    const item = await import('@/app/api/paperbook/[slug]/route');

    const created = await (await list.POST(req('POST', { slug: 'my-post' }))).json();
    expect(created.template).toBe('spiral-notes');

    const all = await (await list.GET()).json();
    expect(all.posts[0].slug).toBe('my-post');

    const got = await (await item.GET(req('GET'), params('my-post'))).json();
    got.series = 'UPDATED';
    const saved = await (await item.PUT(req('PUT', got), params('my-post'))).json();
    expect(saved.series).toBe('UPDATED');
  });

  it('rejects bad slug', async () => {
    const list = await import('@/app/api/paperbook/route');
    const res = await list.POST(req('POST', { slug: 'Bad Slug!' }));
    expect(res.status).toBe(400);
  });

  it('rejects put with 11 slides', async () => {
    const list = await import('@/app/api/paperbook/route');
    const item = await import('@/app/api/paperbook/[slug]/route');
    const created = await (await list.POST(req('POST', { slug: 'cap' }))).json();
    created.slides = Array.from({ length: 11 }, (_, i) => ({
      page_title: `P${i}`, blocks: [{ type: 'heading', text: 'x' }],
    }));
    const res = await item.PUT(req('PUT', created), params('cap'));
    expect(res.status).toBe(400);
  });

  it('render endpoint writes png and reports overflow', async () => {
    const list = await import('@/app/api/paperbook/route');
    const render = await import('@/app/api/paperbook/[slug]/render/route');
    await (await list.POST(req('POST', { slug: 'rend' }))).json();
    const res = await render.POST(req('POST', { slide: 1 }), params('rend'));
    const body = await res.json();
    expect(body.results[0].slide).toBe(1);
    expect(body.results[0].overflowPx).toBe(0);
    expect(existsSync(body.results[0].file)).toBe(true);
  }, 90_000);
});
