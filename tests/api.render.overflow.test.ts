import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { validatePost, type Post } from '@/lib/schema';

/**
 * A page that overflows and cannot flow on is clipped at the foot. Polish condenses it with a
 * single-slide pull-back before densifying anything, and keeps the result only when the
 * re-render clears the overflow without lowering the worst fill.
 *
 * The packer is faked: each authored page flows to one page, and its fill and overflow are read
 * off its title.
 */

const fill = (title: string) => (title.startsWith('Over') || title.startsWith('Stuck') ? 135 : title.startsWith('Short') ? 60 : 90);
const overflow = (title: string) => (title.startsWith('Over') || title.startsWith('Stuck') ? 120 : 0);

vi.mock('@/lib/renderer/capture', async () => {
  const actual = await vi.importActual<typeof import('@/lib/renderer/capture')>('@/lib/renderer/capture');
  return {
    ...actual,
    renderAll: vi.fn(async (post: Post, outDir: string) => {
      mkdirSync(outDir, { recursive: true });
      const results = post.slides.map((s, i) => {
        const file = path.join(outDir, `slide-${String(i + 1).padStart(2, '0')}.png`);
        writeFileSync(file, 'png');
        return { slide: i + 1, overflowPx: overflow(s.page_title), fillPct: fill(s.page_title), file, warnings: [] as string[] };
      });
      return { slides: post.slides, results };
    }),
  };
});

// 'Over' condenses to a page that fits; 'Stuck' comes back still overflowing.
const condenseSlide = vi.fn(async (subject: string, chapter: string, part: number, slideNo: number) => {
  const { loadPost } = await import('@/lib/store');
  const post = await loadPost(subject, chapter, part);
  const slides = post.slides.map((s, i) => (i === slideNo - 1 && s.page_title.startsWith('Over') ? { ...s, page_title: 'Fixed' } : s));
  return { ...post, slides };
});
const fitPlannedPages = vi.fn(async (..._a: unknown[]) => ({ condensed: 0, failed: 0 }));
vi.mock('@/lib/ai/plan', () => ({
  fitPlannedPages: (...a: unknown[]) => fitPlannedPages(...a),
  condenseSlide: (...a: Parameters<typeof condenseSlide>) => condenseSlide(...a),
  densifySlides: vi.fn(async () => { throw new Error('nothing to densify'); }),
  pullBack: vi.fn(),
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
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'iolar-overflow-'));
  vi.resetModules();
});

afterEach(() => { vi.clearAllMocks(); });

describe('polish condenses a page that overflows', () => {
  it('asks condenseSlide for the overflowing page, with its measured need, and keeps the fix', async () => {
    await seed(['Page 1', 'Over 2', 'Page 3']);
    const render = await import('@/app/api/handbooks/[subject]/[chapter]/parts/[part]/render/route');
    const { loadPost } = await import('@/lib/store');

    const body = await (await render.POST(req({ polish: true, polishFollowUps: false }), ctx)).json();

    expect(condenseSlide).toHaveBeenCalledTimes(1);
    expect(condenseSlide).toHaveBeenCalledWith('python', 'lists', 1, 2, 135);
    expect(body.polish.join(' ')).toMatch(/condensed 1 overflowing page/);
    expect(titles(await loadPost('python', 'lists', 1))).toEqual(['Page 1', 'Fixed', 'Page 3']);
  });

  it('puts the page back when the condensed one still overflows', async () => {
    await seed(['Page 1', 'Stuck 2', 'Page 3']);
    condenseSlide.mockImplementationOnce(async (subject, chapter, part, slideNo) => {
      const { loadPost } = await import('@/lib/store');
      const post = await loadPost(subject, chapter, part);
      return { ...post, slides: post.slides.map((s, i) => (i === slideNo - 1 ? { ...s, page_title: 'Stuck 2 shorter' } : s)) };
    });
    const render = await import('@/app/api/handbooks/[subject]/[chapter]/parts/[part]/render/route');
    const { loadPost } = await import('@/lib/store');

    const body = await (await render.POST(req({ polish: true, polishFollowUps: false }), ctx)).json();

    expect(body.polish.join(' ')).toMatch(/condense rolled back/);
    expect(titles(await loadPost('python', 'lists', 1))).toEqual(['Page 1', 'Stuck 2', 'Page 3']);
  });

  it('leaves a part with no overflow alone', async () => {
    await seed(['Page 1', 'Page 2']);
    const render = await import('@/app/api/handbooks/[subject]/[chapter]/parts/[part]/render/route');
    await render.POST(req({ polish: true, polishFollowUps: false }), ctx);
    expect(condenseSlide).not.toHaveBeenCalled();
  });

  it('reports the over-long pages it fitted before rendering', async () => {
    await seed(['Page 1', 'Page 2']);
    fitPlannedPages.mockResolvedValueOnce({ condensed: 2, failed: 0 });
    const render = await import('@/app/api/handbooks/[subject]/[chapter]/parts/[part]/render/route');
    const body = await (await render.POST(req({ polish: true, polishFollowUps: false }), ctx)).json();
    expect(fitPlannedPages).toHaveBeenCalledWith('python', 'lists', 1);
    expect(body.polish[0]).toBe('fitted 2 over-long page(s)');
  });
});
