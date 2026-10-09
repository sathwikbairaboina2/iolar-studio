import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { validatePost, type Post } from '@/lib/schema';

/**
 * A densify attempt that makes the part worse is undone — and undoing it has to cover every
 * part the attempt wrote to. The attempt's render can spill its extra pages into the
 * follow-up part; restoring only this part left that spill behind, so the follow-up repeated
 * pages this part holds again (seen as 36 of 65 sentences duplicated on a local-model build).
 *
 * The packer is faked: each authored page flows to one page, and its fill is read off its
 * title, so a test can say which pages come out thin.
 */

const fill = (title: string) => (title.startsWith('Sliver') ? 10 : title.startsWith('Thin') ? 40 : 90);

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

// The attempt that backfires: the thin page comes back thinner, and three new pages push the
// part past the carousel limit, so the attempt's render spills them into the follow-up.
vi.mock('@/lib/ai/plan', () => ({
  fitPlannedPages: vi.fn(async () => ({ condensed: 0, failed: 0 })),
  densifySlides: vi.fn(async (subject: string, chapter: string, part: number) => {
    const { loadPost } = await import('@/lib/store');
    const post = await loadPost(subject, chapter, part);
    const slides = post.slides.map((s) => (s.page_title.startsWith('Thin') ? { ...s, page_title: 'Sliver' } : s));
    return { ...post, slides: [...slides, page('Dense A'), page('Dense B'), page('Dense C')] };
  }),
}));

const page = (title: string) => ({ page_title: title, blocks: [{ type: 'paragraph' as const, text: `body of ${title}` }] });
const titles = (p: Post) => p.slides.map((s) => s.page_title);

const req = (body: unknown) =>
  new Request('http://t/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ctx = { params: Promise.resolve({ subject: 'python', chapter: 'lists', part: '1' }) };

// Too many pages to fit back into part 1 (10 + 11 > 20), so polish leaves the follow-up where it is.
const earlier = Array.from({ length: 11 }, (_, i) => `Earlier spill ${i + 1}`);
const authored = ['Page 1', 'Page 2', 'Page 3', 'Page 4', 'Thin 5', 'Page 6', 'Page 7', 'Page 8', 'Page 9', 'Page 10'];

async function seed(followUp?: string[]) {
  const subjects = await import('@/app/api/handbooks/route');
  const chapters = await import('@/app/api/handbooks/[subject]/route');
  await subjects.POST(req({ slug: 'python' }));
  await chapters.POST(req({ slug: 'lists' }), { params: Promise.resolve({ subject: 'python' }) });
  const { savePost } = await import('@/lib/store');
  const base = { brand: 'iolar', template: 'spiral-notes', ratio: '3:4' as const, seed: 1, series: 'S', date: 'd', caption: { text: '', hashtags: [] } };
  await savePost('python', 'lists', 1, validatePost({ ...base, slides: authored.map(page) }));
  if (followUp) await savePost('python', 'lists', 2, validatePost({ ...base, series: 'S — PART 2', slides: followUp.map(page), spilledFrom: 1 }));
}

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'iolar-densify-'));
  vi.resetModules();
});

afterEach(() => { vi.clearAllMocks(); });

describe('a densify attempt that is rolled back', () => {
  it('removes the follow-up part the attempt created', async () => {
    await seed();
    const render = await import('@/app/api/handbooks/[subject]/[chapter]/parts/[part]/render/route');
    const { listParts, loadPost } = await import('@/lib/store');

    const body = await (await render.POST(req({ polish: true, polishFollowUps: false }), ctx)).json();

    expect(body.polish.join(' ')).toMatch(/densify rolled back/);
    expect(titles(await loadPost('python', 'lists', 1))).toEqual(authored);
    expect(await listParts('python', 'lists')).toEqual([1]);
  });

  it('puts back the follow-up part an earlier spill had already written', async () => {
    await seed(earlier);
    const render = await import('@/app/api/handbooks/[subject]/[chapter]/parts/[part]/render/route');
    const { listParts, loadPost } = await import('@/lib/store');

    const body = await (await render.POST(req({ polish: true, polishFollowUps: false }), ctx)).json();

    expect(body.polish.join(' ')).toMatch(/densify rolled back/);
    expect(titles(await loadPost('python', 'lists', 1))).toEqual(authored);
    expect(await listParts('python', 'lists')).toEqual([1, 2]);
    expect(titles(await loadPost('python', 'lists', 2))).toEqual(earlier);
  });

  it('still polishes the follow-up it feeds, though the last render did not spill', async () => {
    await seed(earlier);
    const render = await import('@/app/api/handbooks/[subject]/[chapter]/parts/[part]/render/route');
    const chained = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ polish: ['polished'] })));

    const body = await (await render.POST(req({ polish: true }), ctx)).json();

    expect(chained).toHaveBeenCalledTimes(1);
    expect(body.polish).toContain('part 2: polished');
    expect(body.followUp).toMatchObject({ part: 2 });
    chained.mockRestore();
  });

  it('reclaims a small follow-up that fits back into the part, and says so', async () => {
    await seed(['Earlier spill']);
    const render = await import('@/app/api/handbooks/[subject]/[chapter]/parts/[part]/render/route');
    const { listParts, loadPost } = await import('@/lib/store');

    const body = await (await render.POST(req({ polish: true, polishFollowUps: false }), ctx)).json();

    expect(body.polish).toContain('reclaimed part 2');
    expect(await listParts('python', 'lists')).toEqual([1]);
    expect(titles(await loadPost('python', 'lists', 1))).toEqual([...authored, 'Earlier spill']);
  });
});
