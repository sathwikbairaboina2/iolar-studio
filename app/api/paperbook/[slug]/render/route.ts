import { NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';
import { loadPost, postDir } from '@/lib/store';
import { renderSlide, renderAll } from '@/lib/renderer/capture';

type Ctx = { params: Promise<{ slug: string }> };

async function writeReport(
  slug: string,
  results: { slide: number; overflowPx: number; fillPct: number; file: string }[]
) {
  const dir = path.join(postDir(slug), 'renders');
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
    syncRenders(slug, results);
  } catch (err) {
    console.warn('[iolar] render index failed', err);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    const body = await req.json().catch(() => ({}));
    const post = await loadPost(slug);
    const outDir = path.join(postDir(slug), 'renders');

    let results;
    if (typeof body.slide === 'number') {
      const i = body.slide - 1;
      if (i < 0 || i >= post.slides.length) {
        return NextResponse.json({ error: 'slide out of range' }, { status: 400 });
      }
      const file = path.join(outDir, `slide-${String(body.slide).padStart(2, '0')}.png`);
      const r = await renderSlide(post, i, file);
      results = [{ slide: body.slide, overflowPx: r.overflowPx, fillPct: r.fillPct, file }];
    } else {
      results = await renderAll(post, outDir);
    }
    await writeReport(slug, results);
    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const slide = Number(new URL(req.url).searchParams.get('slide') ?? '1');
  const file = path.join(postDir(slug), 'renders', `slide-${String(slide).padStart(2, '0')}.png`);
  try {
    const buf = await fs.readFile(file);
    return new NextResponse(new Uint8Array(buf), {
      headers: { 'content-type': 'image/png', 'cache-control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ error: 'not rendered' }, { status: 404 });
  }
}
