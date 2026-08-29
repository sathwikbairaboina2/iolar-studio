import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { parseUrls } from '@/components/editor/ReferencePanel';

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'iolar-ref-'));
});

describe('parseUrls', () => {
  it('splits on commas and newlines, drops non-urls', () => {
    const text = 'http://a.com/1, http://a.com/2\nhttp://a.com/3\nnot-a-url\n , ';
    expect(parseUrls(text)).toEqual(['http://a.com/1', 'http://a.com/2', 'http://a.com/3']);
  });
});

describe('references api', () => {
  const params = (chapter: string) => ({ params: Promise.resolve({ subject: 'python', chapter }) });

  it('put -> get roundtrip, filters bad urls', async () => {
    const { createSubject, createChapter } = await import('@/lib/store');
    await createSubject('python');
    await createChapter('python', 'ref-demo');
    const route = await import('@/app/api/handbooks/[subject]/[chapter]/references/route');

    const put = await route.PUT(
      new Request('http://t', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ urls: ['http://x.com/1', 'garbage', ' http://x.com/2 '] }),
      }),
      params('ref-demo')
    );
    expect((await put.json()).urls).toEqual(['http://x.com/1', 'http://x.com/2']);

    const get = await route.GET(new Request('http://t'), params('ref-demo'));
    expect((await get.json()).urls).toEqual(['http://x.com/1', 'http://x.com/2']);
  });

  it('empty for post without references', async () => {
    const route = await import('@/app/api/handbooks/[subject]/[chapter]/references/route');
    const get = await route.GET(new Request('http://t'), params('nope'));
    expect((await get.json()).urls).toEqual([]);
  });
});
