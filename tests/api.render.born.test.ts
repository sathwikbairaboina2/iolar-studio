import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { validatePost, type Post } from '@/lib/schema';

/**
 * A page a spill made ("(cont.)") is pulled back into its parent or left alone: densifying it
 * only grows it until it spills again. The packer is faked, a spill page fills 55%.
 */

vi.mock('@/lib/renderer/capture', async () => {
  const actual = await vi.importActual<typeof import('@/lib/renderer/capture')>('@/lib/renderer/capture');
  return {
    ...actual,
    renderAll: vi.fn(async (post: Post, outDir: string) => {
      mkdirSync(outDir, { recursive: true });
      const results = post.slides.map((s, i) => {
        const file = path.join(outDir, `slide-${String(i + 1).padStart(2, '0')}.png`);
        writeFileSync(file, 'png');
        return { slide: i + 1, overflowPx: 0, fillPct: s.page_title.endsWith('(cont.)') ? 55 : 90, file, warnings: [] as string[] };
      });
      return { slides: post.slides, results };
    }),
  };
});

const pullBack = vi.fn();
const densifySlides = vi.fn(async () => { throw new Error('must not densify'); });
vi.mock('@/lib/ai/plan', () => ({
  fitPlannedPages: vi.fn(async () => ({ condensed: 0, failed: 0 })),
  densifySlides: (...a: unknown[]) => (densifySlides as (...x: unknown[]) => unknown)(...a),
  pullBack: (...a: unknown[]) => pullBack(...a),
  condenseSlide: vi.fn(),
}));
vi.mock('@/lib/ai/headings', () => ({
  fixHeadings: vi.fn(async (s: string, c: string, p: number) => (await import('@/lib/store')).loadPost(s, c, p)),
}));

const page = (title: string, cont?: boolean) => ({ page_title: title, ...(cont ? { cont } : {}), blocks: [{ type: 'paragraph' as const, text: `body of ${title}` }] });
const req = (body: unknown) =>
  new Request('http://t/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ctx = { params: Promise.resolve({ subject: 'python', chapter: 'lists', part: '1' }) };

async function seed() {
  const subjects = await import('@/app/api/handbooks/route');
  const chapters = await import('@/app/api/handbooks/[subject]/route');
  await subjects.POST(req({ slug: 'python' }));
  await chapters.POST(req({ slug: 'lists' }), { params: Promise.resolve({ subject: 'python' }) });
  const { savePost } = await import('@/lib/store');
  const base = { brand: 'iolar', template: 'spiral-notes', ratio: '3:4' as const, seed: 1, series: 'S', date: 'd', caption: { text: '', hashtags: [] } };
  await savePost('python', 'lists', 1, validatePost({ ...base, slides: [page('Page 1'), page('Page 1 (cont.)', true), page('Page 3')] }));
}

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'iolar-born-'));
  vi.resetModules();
});
afterEach(() => { vi.clearAllMocks(); });

describe('a spill page in polish', () => {
  it('is pulled back at 55% and never densified', async () => {
    await seed();
    pullBack.mockImplementation(async (s: string, c: string, p: number) => {
      const { loadPost } = await import('@/lib/store');
      const post = await loadPost(s, c, p);
      return { ...post, slides: post.slides.filter((x) => !x.cont) };
    });
    const render = await import('@/app/api/handbooks/[subject]/[chapter]/parts/[part]/render/route');
    const body = await (await render.POST(req({ polish: true, perSlide: true, polishFollowUps: false }), ctx)).json();
    expect(pullBack).toHaveBeenCalledTimes(1);
    expect(pullBack.mock.calls[0].slice(0, 4)).toEqual(['python', 'lists', 1, 2]);
    expect(densifySlides).not.toHaveBeenCalled();
    expect(body.polish.join(' ')).toContain('1 pulled back');
  });

  it('is left alone, not densified, when the pull-back fails', async () => {
    await seed();
    pullBack.mockRejectedValue(new Error('dropped material'));
    const render = await import('@/app/api/handbooks/[subject]/[chapter]/parts/[part]/render/route');
    const { loadPost } = await import('@/lib/store');
    await render.POST(req({ polish: true, perSlide: true, polishFollowUps: false }), ctx);
    expect(densifySlides).not.toHaveBeenCalled();
    expect((await loadPost('python', 'lists', 1)).slides.map((s) => s.page_title)).toEqual(['Page 1', 'Page 1 (cont.)', 'Page 3']);
  });
});
