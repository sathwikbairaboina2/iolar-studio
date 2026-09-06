import { NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';
import { loadPost, savePost } from '@/lib/store';
import { rendersDir } from '@/lib/paths';
import { MAX_SLIDES } from '@/lib/schema';
import { renderSlide, renderAll } from '@/lib/renderer/capture';

type Ctx = { params: Promise<{ subject: string; chapter: string; part: string }> };

async function writeReport(
  subject: string, chapter: string, part: number,
  results: { slide: number; overflowPx: number; fillPct: number; file: string; warnings?: string[] }[]
) {
  const dir = rendersDir(subject, chapter, part);
  await fs.mkdir(dir, { recursive: true });
  const reportPath = path.join(dir, 'render-report.json');
  let existing: Record<string, { overflowPx: number; fillPct?: number; warnings?: string[] }> = {};
  try {
    existing = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  } catch { /* fresh report */ }
  for (const r of results) {
    existing[String(r.slide)] = { overflowPx: r.overflowPx, fillPct: r.fillPct, ...(r.warnings?.length ? { warnings: r.warnings } : {}) };
  }
  await fs.writeFile(reportPath, JSON.stringify(existing, null, 2));
  try {
    const { syncRenders } = await import('@/lib/handbookIndex');
    syncRenders(subject, chapter, part, results);
  } catch (err) {
    console.warn('[instastudio] render index failed', err);
  }
}

export const maxDuration = 900;

type Results = { slide: number; overflowPx: number; fillPct: number; file: string; warnings: string[] }[];

/** Render every page of a part, reflow, spill past the carousel limit, drop stale PNGs. */
async function renderWhole(subject: string, chapter: string, part: number, spill: boolean) {
  const post = await loadPost(subject, chapter, part);
  const outDir = rendersDir(subject, chapter, part);
  const out = await renderAll(post, outDir);
  let results: Results = out.results;
  let split = false;
  let followUp: { moved: number; part: number } | null = null;
  if (out.slides.length !== post.slides.length) {
    await savePost(subject, chapter, part, { ...post, slides: out.slides });
    split = true;
  }
  // Content is never trimmed: pages past the carousel limit become the next part.
  if (spill && out.slides.length > MAX_SLIDES) {
    const { splitIntoFollowUp } = await import('@/lib/ai/spillover');
    followUp = await splitIntoFollowUp(subject, chapter, part);
    if (followUp) {
      const trimmed = await loadPost(subject, chapter, part);
      results = (await renderAll(trimmed, outDir)).results;
    }
  }
  for (const f of await fs.readdir(outDir)) {
    const n = Number(f.match(/^slide-(\d+)\.png$/)?.[1] ?? 0);
    if (n > results.length) await fs.unlink(path.join(outDir, f)).catch(() => {});
  }
  return { results, split, followUp };
}

/** Golden rule: pages must use their space. Pages under this fill (except the last) get densified. */
const POLISH_MIN_FILL = 85;

export async function POST(req: Request, ctx: Ctx) {
  const { subject, chapter, part: partParam } = await ctx.params;
  const part = Number(partParam);
  try {
    const body = await req.json().catch(() => ({}));
    const post = await loadPost(subject, chapter, part);
    const outDir = rendersDir(subject, chapter, part);

    let results: Results;
    let split = false;
    let followUp: { moved: number; part: number } | null = null;

    if (typeof body.slide === 'number') {
      const i = body.slide - 1;
      if (i < 0 || i >= post.slides.length) {
        return NextResponse.json({ error: 'slide out of range' }, { status: 400 });
      }
      const file = path.join(outDir, `slide-${String(body.slide).padStart(2, '0')}.png`);
      const r = await renderSlide(post, i, file);
      results = [{ slide: body.slide, overflowPx: r.overflowPx, fillPct: r.fillPct, file, warnings: r.warnings }];
    } else {
      ({ results, split, followUp } = await renderWhole(subject, chapter, part, body.spillToFollowUp !== false));

      // Opt-in polish: densify the pages that came out thin, then rename any "(cont.)" pages.
      // Each step is an AI proposal applied and re-rendered; the golden rule is checked by pixels.
      if (body.polish) {
        const polish: string[] = [];
        const under = results
          .filter((r, i) => i < results.length - 1 && r.fillPct < POLISH_MIN_FILL)
          .map((r) => ({ slide: r.slide, fillPct: r.fillPct }));
        if (under.length) {
          const { densifySlides } = await import('@/lib/ai/plan');
          await savePost(subject, chapter, part, await densifySlides(subject, chapter, part, under));
          ({ results, split, followUp } = await renderWhole(subject, chapter, part, body.spillToFollowUp !== false));
          polish.push(`densified ${under.length} page(s)`);
        }
        const now = await loadPost(subject, chapter, part);
        if (now.slides.some((s) => / \(cont\.\)$/.test(s.page_title))) {
          const { fixHeadings } = await import('@/lib/ai/headings');
          await savePost(subject, chapter, part, await fixHeadings(subject, chapter, part));
          ({ results } = await renderWhole(subject, chapter, part, false));
          polish.push('continuation titles rewritten');
        }
        await writeReport(subject, chapter, part, results);
        return NextResponse.json({ results, slides: results.length, split, followUp, polish });
      }
    }

    await writeReport(subject, chapter, part, results);
    return NextResponse.json({ results, slides: results.length, split, followUp });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(req: Request, ctx: Ctx) {
  const { subject, chapter, part } = await ctx.params;
  const slide = Number(new URL(req.url).searchParams.get('slide') ?? '1');
  const file = path.join(rendersDir(subject, chapter, Number(part)), `slide-${String(slide).padStart(2, '0')}.png`);
  try {
    const buf = await fs.readFile(file);
    return new NextResponse(new Uint8Array(buf), {
      headers: { 'content-type': 'image/png', 'cache-control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ error: 'not rendered' }, { status: 404 });
  }
}
