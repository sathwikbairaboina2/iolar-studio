import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { validatePost, type Post } from '@/lib/schema';

/**
 * Review's first open fills the part's thin pages, one page per AI call. A page whose fill
 * backfires is undone alone, so the pages that filled well keep their fill. The fill runs
 * once per part: later reviews show the pages as they stand.
 *
 * The packer is faked: each authored page flows to one page, and its fill is read off its
 * title. The model is faked too: "Thin" pages fill, "Trap" pages come back a sliver.
 */

const fill = (title: string) =>
  title.startsWith('Sliver') ? 10 : title.startsWith('Thin') || title.startsWith('Trap') || title.startsWith('Doom') || title.startsWith('Slow') ? 40 : title.startsWith('Half') ? 60 : 90;

vi.mock('@/lib/renderer/capture', async () => {
  const actual = await vi.importActual<typeof import('@/lib/renderer/capture')>('@/lib/renderer/capture');
  return {
    ...actual,
    renderAll: vi.fn(async (post: Post, outDir: string) => {
      mkdirSync(outDir, { recursive: true });
      const results = post.slides.map((s, i) => {
        const file = path.join(outDir, `slide-${String(i + 1).padStart(2, '0')}.png`);
        writeFileSync(file, 'png');
        return { slide: i + 1, overflowPx: 0, fillPct: fill(s.page_title), file, warnings: [] as string[] };
      });
      return { slides: post.slides, results };
    }),
  };
});

vi.mock('@/lib/ai/plan', () => ({
  fitPlannedPages: vi.fn(async () => ({ condensed: 0, failed: 0 })),
  densifySlides: vi.fn(async (subject: string, chapter: string, part: number, under: { slide: number; gentle?: boolean }[]) => {
    const { loadPost } = await import('@/lib/store');
    const post = await loadPost(subject, chapter, part);
    const asked = new Set(under.map((u) => u.slide));
    // Trap spills unless asked gently; Doom spills whatever it is asked.
    const gentle = under.some((u) => u.gentle);
    const slides = post.slides.map((s, i) => {
      if (!asked.has(i + 1)) return s;
      return { ...s, page_title: s.page_title.startsWith('Doom') || (s.page_title.startsWith('Trap') && !gentle) ? 'Sliver' : s.page_title.startsWith('Slow') ? `Half ${i + 1}` : `Full ${i + 1}` };
    });
    return { ...post, slides };
  }),
}));

const page = (title: string) => ({ page_title: title, blocks: [{ type: 'paragraph' as const, text: `body of ${title}` }] });
const titles = (p: Post) => p.slides.map((s) => s.page_title);

const req = (body: unknown) =>
  new Request('http://t/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ctx = { params: Promise.resolve({ subject: 'python', chapter: 'lists', part: '1' }) };

async function seed(authored: string[]) {
  const subjects = await import('@/app/api/handbooks/route');
  const chapters = await import('@/app/api/handbooks/[subject]/route');
  await subjects.POST(req({ slug: 'python' }));
  await chapters.POST(req({ slug: 'lists' }), { params: Promise.resolve({ subject: 'python' }) });
  const { savePost } = await import('@/lib/store');
  const base = { brand: 'iolar', template: 'spiral-notes', ratio: '3:4' as const, seed: 1, series: 'S', date: 'd', caption: { text: '', hashtags: [] } };
  await savePost('python', 'lists', 1, validatePost({ ...base, slides: authored.map(page) }));
}

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'iolar-autofill-'));
  vi.resetModules();
});

afterEach(() => { vi.clearAllMocks(); });

describe('per-slide polish', () => {
  it('asks the model about one page per call', async () => {
    await seed(['Page 1', 'Thin 2', 'Page 3', 'Thin 4', 'Page 5']);
    const render = await import('@/app/api/handbooks/[subject]/[chapter]/parts/[part]/render/route');
    const { densifySlides } = await import('@/lib/ai/plan');
    const { loadPost } = await import('@/lib/store');

    const body = await (await render.POST(req({ polish: true, perSlide: true, polishFollowUps: false }), ctx)).json();

    const calls = vi.mocked(densifySlides).mock.calls.map((c) => c[3].map((u) => u.slide));
    expect(calls).toEqual([[2], [4]]);
    expect(titles(await loadPost('python', 'lists', 1))).toEqual(['Page 1', 'Full 2', 'Page 3', 'Full 4', 'Page 5']);
    expect(body.polish.join(' ')).toMatch(/densified 2 page\(s\) one at a time/);
  });

  it('undoes only the page that backfired, once its gentle retry spills too', async () => {
    await seed(['Page 1', 'Doom 2', 'Page 3', 'Thin 4', 'Page 5']);
    const render = await import('@/app/api/handbooks/[subject]/[chapter]/parts/[part]/render/route');
    const { loadPost } = await import('@/lib/store');

    const body = await (await render.POST(req({ polish: true, perSlide: true, polishFollowUps: false }), ctx)).json();

    expect(titles(await loadPost('python', 'lists', 1))).toEqual(['Page 1', 'Doom 2', 'Page 3', 'Full 4', 'Page 5']);
    expect(body.polish.join(' ')).toContain('densified 1 page(s) one at a time, 2 rolled back');
  });

  it('retries a page that spilled with a gentle ask, and keeps it when that fits', async () => {
    await seed(['Page 1', 'Trap 2', 'Page 3']);
    const render = await import('@/app/api/handbooks/[subject]/[chapter]/parts/[part]/render/route');
    const { densifySlides } = await import('@/lib/ai/plan');
    const { loadPost } = await import('@/lib/store');

    const body = await (await render.POST(req({ polish: true, perSlide: true, polishFollowUps: false }), ctx)).json();

    expect(vi.mocked(densifySlides).mock.calls.map((c) => c[3])).toEqual([
      [{ slide: 2, fillPct: 40 }],
      [{ slide: 2, fillPct: 40, gentle: true }],
    ]);
    expect(titles(await loadPost('python', 'lists', 1))).toEqual(['Page 1', 'Full 2', 'Page 3']);
    expect(body.polish.join(' ')).toContain('densified 1 page(s) one at a time, 1 rolled back');
  });

  it('asks a page again when the first fill left it fuller but still thin, and stops there', async () => {
    await seed(['Page 1', 'Slow 2', 'Page 3']);
    const render = await import('@/app/api/handbooks/[subject]/[chapter]/parts/[part]/render/route');
    const { densifySlides } = await import('@/lib/ai/plan');
    const { loadPost } = await import('@/lib/store');

    const body = await (await render.POST(req({ polish: true, perSlide: true, polishFollowUps: false }), ctx)).json();

    expect(vi.mocked(densifySlides).mock.calls.map((c) => c[3].map((u) => u.slide))).toEqual([[2], [2]]);
    expect(titles(await loadPost('python', 'lists', 1))).toEqual(['Page 1', 'Full 2', 'Page 3']);
    expect(body.polish.join(' ')).toContain('densified 1 page(s) one at a time');
  });

  it('keeps the whole-part polish when per-slide is not asked for', async () => {
    await seed(['Page 1', 'Thin 2', 'Page 3', 'Thin 4', 'Page 5']);
    const render = await import('@/app/api/handbooks/[subject]/[chapter]/parts/[part]/render/route');
    const { densifySlides } = await import('@/lib/ai/plan');

    await render.POST(req({ polish: true, polishFollowUps: false }), ctx);

    expect(vi.mocked(densifySlides).mock.calls.map((c) => c[3].map((u) => u.slide))).toEqual([[2, 4]]);
  });
});

describe('review auto-fill', () => {
  it('fills per slide on the first review and skips every review after', async () => {
    await seed(['Page 1', 'Thin 2', 'Page 3']);
    const render = await import('@/app/api/handbooks/[subject]/[chapter]/parts/[part]/render/route');
    const { densifySlides } = await import('@/lib/ai/plan');
    const { loadPost } = await import('@/lib/store');

    const first = await (await render.POST(req({ autoFill: true }), ctx)).json();
    expect(first.polish.join(' ')).toMatch(/one at a time/);
    expect(titles(await loadPost('python', 'lists', 1))).toEqual(['Page 1', 'Full 2', 'Page 3']);

    const second = await (await render.POST(req({ autoFill: true }), ctx)).json();
    expect(second).toEqual({ skipped: true });
    expect(vi.mocked(densifySlides)).toHaveBeenCalledTimes(1);
  });
});
