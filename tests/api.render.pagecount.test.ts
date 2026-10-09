import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { validatePost } from '@/lib/schema';

/**
 * The editor previews one slide at a time. A part not flowed yet holds fewer authored slides than
 * pages, and the preview drew "[Page 02 of 02]" on page 2 of a 19-page part. The one-slide render
 * is told the part's real page count: the pages its last whole render produced.
 */

const renderSlide = vi.fn(async (_post: unknown, _i: number, file: string, _opts?: { pageCount?: number }) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, 'png');
  return { overflowPx: 0, fillPct: 80, spillIndexes: [], neededPct: 80, warnings: [] as string[] };
});
vi.mock('@/lib/renderer/capture', async () => ({
  ...(await vi.importActual<typeof import('@/lib/renderer/capture')>('@/lib/renderer/capture')),
  renderSlide: (...a: Parameters<typeof renderSlide>) => renderSlide(...a),
}));

const req = (body: unknown) =>
  new Request('http://t/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ctx = { params: Promise.resolve({ subject: 'python', chapter: 'lists', part: '1' }) };
const page = (t: string) => ({ page_title: t, blocks: [{ type: 'paragraph' as const, text: t }] });

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'iolar-pagecount-'));
  vi.resetModules();
  renderSlide.mockClear();
});

async function seed(report?: Record<string, unknown>) {
  const subjects = await import('@/app/api/handbooks/route');
  const chapters = await import('@/app/api/handbooks/[subject]/route');
  await subjects.POST(req({ slug: 'python' }));
  await chapters.POST(req({ slug: 'lists' }), { params: Promise.resolve({ subject: 'python' }) });
  const { savePost } = await import('@/lib/store');
  const { rendersDir } = await import('@/lib/paths');
  await savePost('python', 'lists', 1, validatePost({
    brand: 'iolar', template: 'notebook', ratio: '3:4', seed: 1, series: 'S', date: 'd',
    slides: [page('One'), page('Two')], caption: { text: '', hashtags: [] },
  }));
  if (report) {
    mkdirSync(rendersDir('python', 'lists', 1), { recursive: true });
    writeFileSync(path.join(rendersDir('python', 'lists', 1), 'render-report.json'), JSON.stringify(report));
  }
}

describe('one-slide preview render', () => {
  it('passes the part\'s real page count from its last whole render', async () => {
    const report = Object.fromEntries(Array.from({ length: 19 }, (_, i) => [String(i + 1), { overflowPx: 0, fillPct: 90 }]));
    await seed(report);
    const render = await import('@/app/api/handbooks/[subject]/[chapter]/parts/[part]/render/route');
    await render.POST(req({ slide: 2 }), ctx);
    expect(renderSlide).toHaveBeenCalledTimes(1);
    expect(renderSlide.mock.calls[0][3]).toEqual({ pageCount: 19 });
  });

  it('falls back to the slides in the post when nothing was rendered yet', async () => {
    await seed();
    const render = await import('@/app/api/handbooks/[subject]/[chapter]/parts/[part]/render/route');
    await render.POST(req({ slide: 2 }), ctx);
    expect(renderSlide.mock.calls[0][3]).toEqual({ pageCount: 2 });
  });
});
