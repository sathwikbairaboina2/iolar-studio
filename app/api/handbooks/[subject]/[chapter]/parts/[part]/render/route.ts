import { NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';
import { loadPost, savePost, listParts } from '@/lib/store';
import { rendersDir } from '@/lib/paths';
import { MAX_SLIDES } from '@/lib/schema';
import { renderSlide, renderAll } from '@/lib/renderer/capture';

type Ctx = { params: Promise<{ subject: string; chapter: string; part: string }> };
type Result = { slide: number; overflowPx: number; fillPct: number; file: string };

async function writeReport(
  subject: string, chapter: string, part: number,
  results: Result[],
  replace = false
) {
  const dir = rendersDir(subject, chapter, part);
  await fs.mkdir(dir, { recursive: true });
  const reportPath = path.join(dir, 'render-report.json');
  let existing: Record<string, { overflowPx: number; fillPct?: number }> = {};
  if (!replace) {
    try {
      existing = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    } catch { /* fresh report */ }
  }
  for (const r of results) existing[String(r.slide)] = { overflowPx: r.overflowPx, fillPct: r.fillPct };
  await fs.writeFile(reportPath, JSON.stringify(existing, null, 2));
  try {
    const { syncRenders } = await import('@/lib/graph');
    syncRenders(subject, chapter, part, results);
  } catch (err) {
    console.warn('[instastudio] render index failed', err);
  }
}

/** Drops page images left behind by a render that produced fewer pages than the last one. */
async function pruneImages(outDir: string, keep: number) {
  for (const f of await fs.readdir(outDir)) {
    const n = Number(f.match(/^slide-(\d+)\.png$/)?.[1] ?? 0);
    if (n > keep) await fs.unlink(path.join(outDir, f)).catch(() => {});
  }
}

/** Renders one part end to end and saves the pagination it settled on. */
async function renderPart(subject: string, chapter: string, part: number) {
  const post = await loadPost(subject, chapter, part);
  const outDir = rendersDir(subject, chapter, part);
  const out = await renderAll(post, outDir);
  if (out.slides.length !== post.slides.length) {
    await savePost(subject, chapter, part, { ...post, slides: out.slides });
  }
  await pruneImages(outDir, out.results.length);
  await writeReport(subject, chapter, part, out.results, true);
  return out;
}

const THIN = 88; // below this a page has visible empty space worth filling

/**
 * The optional refine pass. Rendering measures every page, so this is the moment when the
 * two things that need measurements are cheapest: growing pages that came out thin, and
 * renaming the "(cont.)" placeholders auto-flow leaves behind. Both call the AI, so they
 * only run when the caller asks for them.
 */
async function refinePart(
  subject: string, chapter: string, part: number, results: Result[]
): Promise<{ fitted: boolean; retitled: boolean; note?: string }> {
  const out = { fitted: false, retitled: false, note: undefined as string | undefined };

  if (results.some((r) => r.fillPct < THIN)) {
    try {
      const { fitToPages } = await import('@/lib/ai/fit');
      const { proposal } = await fitToPages(subject, chapter, part);
      await savePost(subject, chapter, part, proposal);
      out.fitted = true;
    } catch (err) {
      // A rejected proposal is a normal outcome — the gate exists to protect the content.
      out.note = `fit skipped: ${String(err).slice(0, 200)}`;
    }
  }

  const current = await loadPost(subject, chapter, part);
  if (current.slides.some((s) => /\(cont\.\)/i.test(s.page_title))) {
    try {
      const { fixHeadings } = await import('@/lib/ai/headings');
      await savePost(subject, chapter, part, await fixHeadings(subject, chapter, part));
      out.retitled = true;
    } catch (err) {
      out.note = [out.note, `titles skipped: ${String(err).slice(0, 200)}`].filter(Boolean).join('; ');
    }
  }
  return out;
}

export const maxDuration = 900;

export async function POST(req: Request, ctx: Ctx) {
  const { subject, chapter, part: partParam } = await ctx.params;
  const part = Number(partParam);
  try {
    const body = await req.json().catch(() => ({}));
    const post = await loadPost(subject, chapter, part);
    const outDir = rendersDir(subject, chapter, part);

    // One page: no pagination, no spill handling, no refine — just redraw it.
    if (typeof body.slide === 'number') {
      const i = body.slide - 1;
      if (i < 0 || i >= post.slides.length) {
        return NextResponse.json({ error: 'slide out of range' }, { status: 400 });
      }
      const file = path.join(outDir, `slide-${String(body.slide).padStart(2, '0')}.png`);
      const r = await renderSlide(post, i, file);
      const results = [{ slide: body.slide, overflowPx: r.overflowPx, fillPct: r.fillPct, file }];
      await writeReport(subject, chapter, part, results, false);
      return NextResponse.json({ results, slides: results.length, split: false, followUp: null });
    }

    const out = await renderAll(post, outDir);
    let results = out.results;
    let split = out.slides.length !== post.slides.length;
    if (split) await savePost(subject, chapter, part, { ...post, slides: out.slides });

    let followUp: { moved: number; part: number } | null = null;
    let followUpParts: number[] = [];

    /**
     * Content is never trimmed: pages past the carousel limit become the next part, and the
     * parts they create are rendered here — a follow-up nobody rendered is an unfinished post.
     */
    const settle = async (pages: number) => {
      if (body.spillToFollowUp === false || pages <= MAX_SLIDES) return;
      const { splitIntoFollowUp } = await import('@/lib/ai/spillover');
      const moved = await splitIntoFollowUp(subject, chapter, part);
      if (!moved) return;
      followUp = moved;
      results = (await renderPart(subject, chapter, part)).results;
      followUpParts = (await listParts(subject, chapter)).filter((p) => p > part).sort((a, b) => a - b);
      for (const p of followUpParts) await renderPart(subject, chapter, p);
    };

    await settle(out.slides.length);

    let refined: Awaited<ReturnType<typeof refinePart>> | null = null;
    if (body.refine === true) {
      refined = await refinePart(subject, chapter, part, results);
      if (refined.fitted || refined.retitled) {
        // Growing thin pages can push the part back over the limit, so it settles again.
        results = (await renderPart(subject, chapter, part)).results;
        await settle(results.length);
        split = true;
      }
    }

    await pruneImages(outDir, results.length);
    await writeReport(subject, chapter, part, results, true);
    return NextResponse.json({
      results, slides: results.length, split, followUp, followUpParts, refined,
    });
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
