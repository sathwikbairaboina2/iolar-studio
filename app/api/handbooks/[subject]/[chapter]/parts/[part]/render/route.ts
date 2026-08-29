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
  results: { slide: number; overflowPx: number; fillPct: number; file: string }[]
) {
  const dir = rendersDir(subject, chapter, part);
  await fs.mkdir(dir, { recursive: true });
  const reportPath = path.join(dir, 'render-report.json');
  let existing: Record<string, { overflowPx: number; fillPct?: number }> = {};
  try {
    existing = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  } catch { /* fresh report */ }
  for (const r of results) existing[String(r.slide)] = { overflowPx: r.overflowPx, fillPct: r.fillPct };
  await fs.writeFile(reportPath, JSON.stringify(existing, null, 2));
  try {
    const { syncRenders } = await import('@/lib/graph');
    syncRenders(subject, chapter, part, results);
  } catch (err) {
    console.warn('[instastudio] render index failed', err);
  }
}

export const maxDuration = 900;

export async function POST(req: Request, ctx: Ctx) {
  const { subject, chapter, part: partParam } = await ctx.params;
  const part = Number(partParam);
  try {
    const body = await req.json().catch(() => ({}));
    const post = await loadPost(subject, chapter, part);
    const outDir = rendersDir(subject, chapter, part);

    let results;
    let split = false;
    let followUp: { moved: number; part: number } | null = null;

    if (typeof body.slide === 'number') {
      const i = body.slide - 1;
      if (i < 0 || i >= post.slides.length) {
        return NextResponse.json({ error: 'slide out of range' }, { status: 400 });
      }
      const file = path.join(outDir, `slide-${String(body.slide).padStart(2, '0')}.png`);
      const r = await renderSlide(post, i, file);
      results = [{ slide: body.slide, overflowPx: r.overflowPx, fillPct: r.fillPct, file }];
    } else {
      const out = await renderAll(post, outDir);
      results = out.results;
      if (out.slides.length !== post.slides.length) {
        await savePost(subject, chapter, part, { ...post, slides: out.slides });
        split = true;
      }
      // Content is never trimmed: pages past the carousel limit become the next part.
      if (body.spillToFollowUp !== false && out.slides.length > MAX_SLIDES) {
        const { splitIntoFollowUp } = await import('@/lib/ai/spillover');
        followUp = await splitIntoFollowUp(subject, chapter, part);
        if (followUp) {
          const trimmed = await loadPost(subject, chapter, part);
          const rerun = await renderAll(trimmed, outDir);
          results = rerun.results;
          for (const f of await fs.readdir(outDir)) {
            const n = Number(f.match(/^slide-(\d+)\.png$/)?.[1] ?? 0);
            if (n > results.length) await fs.unlink(path.join(outDir, f)).catch(() => {});
          }
        }
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
