import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { validatePost, type Post } from '@/lib/schema';

// The spill mechanics are pinned at a 10-page carousel; the live limit is 20.
vi.mock('@/lib/schema', async (orig) => ({ ...(await orig<typeof import('@/lib/schema')>()), MAX_SLIDES: 10 }));

/**
 * A spill has to leave the part consistent: post.json, the PNGs and the report all agreeing
 * on how many pages there are. Trimming the authored pages does not settle that on its own,
 * because the packer reflows what is left — so these pin the render route against the shape
 * that used to slip through: eleven pages of PNG for a part that says it has ten.
 *
 * The packer is faked. Real rendering is a browser per page and the point here is the
 * bookkeeping around it, not the pixels; `tests/render.e2e.test.ts` owns those.
 */

/** Pages the fake packer flows to, one entry per call to renderAll. */
let flow: number[] = [];
let calls = 0;

const page = (n: number) => ({ page_title: `Page ${n}`, blocks: [{ type: 'paragraph' as const, text: `body ${n}` }] });

vi.mock('@/lib/renderer/capture', async () => {
  const actual = await vi.importActual<typeof import('@/lib/renderer/capture')>('@/lib/renderer/capture');
  return {
    ...actual,
    renderAll: vi.fn(async (_post: Post, outDir: string) => {
      const pages = flow[Math.min(calls++, flow.length - 1)];
      mkdirSync(outDir, { recursive: true });
      const slides = Array.from({ length: pages }, (_, i) => page(i + 1));
      const results = slides.map((_, i) => {
        const file = path.join(outDir, `slide-${String(i + 1).padStart(2, '0')}.png`);
        writeFileSync(file, 'png');
        return { slide: i + 1, overflowPx: 0, fillPct: 90, file, warnings: [] as string[] };
      });
      return { slides, results };
    }),
  };
});

const req = (body?: unknown) =>
  new Request('http://t/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const ctx = { params: Promise.resolve({ subject: 'python', chapter: 'lists', part: '1' }) };
const dirOf = (part: number) =>
  path.join(process.env.IOLAR_DATA_DIR!, 'handbooks', 'python', 'lists', 'parts', String(part).padStart(2, '0'));
const readPost = (part: number): Post => JSON.parse(readFileSync(path.join(dirOf(part), 'post.json'), 'utf8'));
const pngs = (part: number) => readdirSync(path.join(dirOf(part), 'renders')).filter((f) => /^slide-\d+\.png$/.test(f));
const report = (part: number) =>
  JSON.parse(readFileSync(path.join(dirOf(part), 'renders', 'render-report.json'), 'utf8')) as Record<string, unknown>;

async function seed(slides: number) {
  const subjects = await import('@/app/api/handbooks/route');
  const chapters = await import('@/app/api/handbooks/[subject]/route');
  await subjects.POST(new Request('http://t/api', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: 'python' }),
  }));
  await chapters.POST(new Request('http://t/api', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: 'lists' }),
  }), { params: Promise.resolve({ subject: 'python' }) });
  const { savePost } = await import('@/lib/store');
  await savePost('python', 'lists', 1, validatePost({
    brand: 'iolar', template: 'spiral-notes', ratio: '3:4', seed: 1, series: 'S', date: 'd',
    slides: Array.from({ length: slides }, (_, i) => page(i + 1)),
    caption: { text: '', hashtags: [] },
  }));
}

beforeEach(() => {
  process.env.IOLAR_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'iolar-spill-'));
  flow = [];
  calls = 0;
  vi.resetModules();
});

afterEach(() => { vi.clearAllMocks(); });

describe('a part that spills past the carousel limit', () => {
  it('leaves post.json, the PNGs and the report agreeing when the trimmed part reflows over the limit again', async () => {
    // 12 authored pages flow to 12; the spill trims to 10, and the reflow still lands on 11.
    // That second overflow is what used to be dropped on the floor.
    flow = [12, 11, 10];
    await seed(12);
    const render = await import('@/app/api/handbooks/[subject]/[chapter]/parts/[part]/render/route');

    const body = await (await render.POST(req({}), ctx)).json();

    expect(body.followUp).not.toBeNull();
    expect(body.slides).toBe(10);
    expect(readPost(1).slides).toHaveLength(10);
    expect(pngs(1)).toHaveLength(10);
    expect(Object.keys(report(1))).toHaveLength(10);
  });

  it('packages after one render, rather than needing a second to clear a stale page', async () => {
    flow = [11, 11, 10];
    await seed(11);
    const render = await import('@/app/api/handbooks/[subject]/[chapter]/parts/[part]/render/route');
    const pkg = await import('@/app/api/handbooks/[subject]/[chapter]/parts/[part]/package/route');

    await render.POST(req({}), ctx);
    const out = await pkg.POST(req(), ctx);

    expect(out.status).toBe(200);
    expect((await out.json()).files).toHaveLength(11); // 10 pages + caption.txt
  });

  it('gives up rather than looping when the part will not settle under the limit', async () => {
    flow = [11]; // every reflow lands on 11 again
    await seed(11);
    const render = await import('@/app/api/handbooks/[subject]/[chapter]/parts/[part]/render/route');

    const body = await (await render.POST(req({}), ctx)).json();

    // It stops after the bounded passes and still reports honestly: the pages it hands back
    // are the ones on disk and in post.json, so nothing downstream sees a stale page.
    expect(body.slides).toBe(readPost(1).slides.length);
    expect(pngs(1)).toHaveLength(body.slides);
    expect(Object.keys(report(1))).toHaveLength(body.slides);
  });

  it('keeps the other pages when a single slide is redrawn', async () => {
    flow = [4];
    await seed(4);
    const render = await import('@/app/api/handbooks/[subject]/[chapter]/parts/[part]/render/route');
    await render.POST(req({}), ctx);
    expect(Object.keys(report(1))).toHaveLength(4);

    await render.POST(req({ slide: 2 }), ctx);

    // A single-slide render merges: it must not wipe the report down to the one page it drew.
    expect(Object.keys(report(1))).toHaveLength(4);
  });

  it('does not spill when the caller turns it off', async () => {
    flow = [12];
    await seed(12);
    const render = await import('@/app/api/handbooks/[subject]/[chapter]/parts/[part]/render/route');

    const body = await (await render.POST(req({ spillToFollowUp: false }), ctx)).json();

    expect(body.followUp).toBeNull();
    expect(body.slides).toBe(12);
    expect(readPost(1).slides).toHaveLength(12);
    expect(Object.keys(report(1))).toHaveLength(12);
  });
});
