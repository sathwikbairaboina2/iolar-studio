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
  // The flow's own pages are written back whenever they differ from what was authored —
  // a different page count, or a page it had to carry over. Otherwise a "(cont.)" title
  // lives only inside the render, where no later pass can see or rename it.
  if (out.slides.length !== post.slides.length || out.slides.some((s) => s.cont)) {
    await savePost(subject, chapter, part, { ...post, slides: out.slides });
    split = out.slides.length !== post.slides.length;
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

/** Golden rule: pages must use their space. Pages under this fill get densified. */
const POLISH_MIN_FILL = 85;
/** The last page ends the handbook, so it may run short — but not half empty. */
const POLISH_LAST_MIN_FILL = 60;

/** A page the auto-flow carried over from the page before it. */
const hasContinuation = (title: string) => / \(cont\.\)$/.test(title);

/** The emptiest page of the part: what polish must never make worse. */
const worstFill = (rs: Results) => Math.min(...rs.map((r) => r.fillPct));

/** Re-enters this route for a follow-up part with polish on; returns its polish notes prefixed by part. */
async function polishChain(req: Request, subject: string, chapter: string, part: number): Promise<string[]> {
  const url = new URL(req.url);
  url.pathname = url.pathname.replace(/\/parts\/\d+\/render$/, `/parts/${part}/render`);
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ polish: true }) });
  if (!res.ok) return [`part ${part}: polish failed (${res.status})`];
  const body = (await res.json()) as { polish?: string[] };
  return (body.polish ?? []).map((p) => `part ${part}: ${p}`);
}

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
          .filter((r, i) => r.fillPct < (i < results.length - 1 ? POLISH_MIN_FILL : POLISH_LAST_MIN_FILL))
          .map((r) => ({ slide: r.slide, fillPct: r.fillPct }));
        if (under.length) {
          // Densifying can backfire: added content overflows onto a new page that is thinner
          // than the one we set out to fill. The pixels decide — a pass that lowers the worst
          // fill on the part is undone and the pages we already had are put back.
          const { densifySlides } = await import('@/lib/ai/plan');
          const before = { post: await loadPost(subject, chapter, part), worst: worstFill(results) };
          await savePost(subject, chapter, part, await densifySlides(subject, chapter, part, under));
          ({ results, split, followUp } = await renderWhole(subject, chapter, part, body.spillToFollowUp !== false));
          if (worstFill(results) < before.worst) {
            await savePost(subject, chapter, part, before.post);
            ({ results, split, followUp } = await renderWhole(subject, chapter, part, body.spillToFollowUp !== false));
            polish.push(`densify rolled back (worst fill ${worstFill(results)}% beat the attempt)`);
          } else {
            polish.push(`densified ${under.length} page(s)`);
          }
        }
        // Renaming changes the titles, the re-render reflows, and the new split can mint a
        // fresh "(cont.)" page — so rename until the pages settle, twice at most.
        const { fixHeadings } = await import('@/lib/ai/headings');
        for (let pass = 0; pass < 2; pass++) {
          const now = await loadPost(subject, chapter, part);
          if (!now.slides.some((s) => hasContinuation(s.page_title))) break;
          await savePost(subject, chapter, part, await fixHeadings(subject, chapter, part));
          ({ results } = await renderWhole(subject, chapter, part, false));
          polish.push(pass === 0 ? 'continuation titles rewritten' : 'continuation titles rewritten again after the reflow');
        }
        await writeReport(subject, chapter, part, results);
        // A spill during this render minted a follow-up part; polish it the same way so the
        // whole chain (every part, every "(cont.)" title) comes out finished from one click.
        if (followUp && body.polishFollowUps !== false) {
          const chain = await polishChain(req, subject, chapter, followUp.part);
          polish.push(...chain);
        }
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
