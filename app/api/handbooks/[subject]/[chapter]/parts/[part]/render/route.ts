import { NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';
import { listParts, loadPost, savePost } from '@/lib/store';
import { partDir, rendersDir } from '@/lib/paths';
import { MAX_SLIDES, type Post } from '@/lib/schema';
import { chapterCategory } from '@/lib/store';
import { categoryOf } from '@/lib/handbookCategories';
import { thinPages, isContinuation } from '@/lib/ai/fill';
import { renderSlide, renderAll } from '@/lib/renderer/capture';

type Ctx = { params: Promise<{ subject: string; chapter: string; part: string }> };

async function writeReport(
  subject: string, chapter: string, part: number,
  results: { slide: number; overflowPx: number; fillPct: number; file: string; warnings?: string[] }[],
  /**
   * A whole-part render replaces the report; a single-slide render merges into it.
   *
   * Merging always leaves a page behind. When a spill shrinks a part from eleven pages to
   * ten, page eleven's entry survives — and the chapter listing counts report entries as the
   * part's pages, so the chapter goes on claiming a page that no longer exists.
   */
  replace = false
) {
  const dir = rendersDir(subject, chapter, part);
  await fs.mkdir(dir, { recursive: true });
  const reportPath = path.join(dir, 'render-report.json');
  let existing: Record<string, { overflowPx: number; fillPct?: number; warnings?: string[] }> = {};
  if (!replace) {
    try {
      existing = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    } catch { /* fresh report */ }
  }
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

/** `undrawn`: blocks a single-slide render left off the page (their space is not in fillPct). */
type Results = { slide: number; overflowPx: number; fillPct: number; file: string; warnings: string[]; undrawn?: number }[];

/**
 * How many times one render may spill before it gives up and hands back a part still over
 * the limit. Each pass moves the surplus and reflows what is left, and a part that has not
 * settled by the third is not converging — an unsplittable block, usually — so looping on
 * would only burn renders.
 */
const SPILL_PASSES = 3;

/** Render every page of a part, reflow, spill past the carousel limit, drop stale PNGs. */
async function renderWhole(subject: string, chapter: string, part: number, spill: boolean) {
  const post = await loadPost(subject, chapter, part);
  const outDir = rendersDir(subject, chapter, part);
  const out = await renderAll(post, outDir);
  let results: Results = out.results;
  let flowed = out.slides;
  let split = false;
  let followUp: { moved: number; part: number } | null = null;
  // The flow's own pages are written back whenever they differ from what was authored —
  // a different page count, or a page it had to carry over. Otherwise a "(cont.)" title
  // lives only inside the render, where no later pass can see or rename it.
  if (flowed.length !== post.slides.length || flowed.some((s) => s.cont)) {
    await savePost(subject, chapter, part, { ...post, slides: flowed });
    split = flowed.length !== post.slides.length;
  }
  // Content is never trimmed: pages past the carousel limit become the next part.
  //
  // This is a loop because a spill caps the AUTHORED pages, not the RENDERED ones. The
  // packer reflows what is left, so ten authored pages can still land on eleven, and one
  // pass would hand back a part that is still over the limit. Re-spilling is safe by
  // design: the surplus always returns to the same follow-up and merges with what is
  // already there, so a second pass moves the overflow rather than minting a third part.
  if (spill && flowed.length > MAX_SLIDES) {
    const { splitIntoFollowUp } = await import('@/lib/ai/spillover');
    for (let pass = 0; pass < SPILL_PASSES && flowed.length > MAX_SLIDES; pass++) {
      const moved = await splitIntoFollowUp(subject, chapter, part);
      if (!moved) break;
      followUp = moved;
      split = true;
      const trimmed = await loadPost(subject, chapter, part);
      const again = await renderAll(trimmed, outDir);
      results = again.results;
      flowed = again.slides;
      // The flow after a spill is the part's new shape, and it is written back for the same
      // reason the first render is. Left unsaved, post.json still claims the pages the spill
      // took away while their PNGs sit in the folder, and packaging refuses the part as
      // stale until someone renders it a second time.
      if (flowed.length !== trimmed.slides.length || flowed.some((s) => s.cont)) {
        await savePost(subject, chapter, part, { ...trimmed, slides: flowed });
      }
    }
  }
  for (const f of await fs.readdir(outDir)) {
    const n = Number(f.match(/^slide-(\d+)\.png$/)?.[1] ?? 0);
    if (n > results.length) await fs.unlink(path.join(outDir, f)).catch(() => {});
  }
  return { results, split, followUp };
}

/**
 * Golden rule: pages must use their space. The target is the chapter's category's (85% for a
 * handbook, less for a listicle page that is meant to breathe); see lib/ai/fill.ts.
 */
/** Per-slide fill: how many asks one page gets while each one leaves it fuller but still thin. */
const PER_SLIDE_TRIES = 2;


/** The emptiest page of the part: what polish must never make worse. */
const worstFill = (rs: Results) => Math.min(...rs.map((r) => r.fillPct));

/** Pages drawn clipped: their content is taller than the page and could not flow on. */
const overflowing = (rs: Results) => rs.filter((r) => r.overflowPx > 0);

/**
 * What a render of this part may write outside it: the follow-up parts its spill feeds. Kept
 * so an undone densify can undo its spill too — restoring this part alone leaves the
 * follow-up holding pages this part holds again, and the handbook teaches them twice.
 */
async function snapshotFollowUps(subject: string, chapter: string, part: number) {
  const parts = await listParts(subject, chapter);
  const followUps = new Map<number, Post>();
  for (const n of parts) {
    const post = await loadPost(subject, chapter, n).catch(() => null);
    if (post?.spilledFrom === part) followUps.set(n, post);
  }
  return { parts, followUps };
}

async function restoreFollowUps(subject: string, chapter: string, snap: Awaited<ReturnType<typeof snapshotFollowUps>>) {
  // A part the attempt minted holds nothing but its spill: no render or report has run on it.
  for (const n of await listParts(subject, chapter)) {
    if (!snap.parts.includes(n)) await fs.rm(partDir(subject, chapter, n), { recursive: true, force: true });
  }
  for (const [n, post] of snap.followUps) await savePost(subject, chapter, n, post);
}


/**
 * Left in the part once review has filled it, so the fill runs on the first review only.
 * Later reviews show the pages as they stand, including any edits made since.
 */
const autoFillMarker = (subject: string, chapter: string, part: number) =>
  path.join(partDir(subject, chapter, part), '.autofilled');

/** Re-enters this route for a follow-up part with polish on; returns its polish notes prefixed by part. */
async function polishChain(req: Request, subject: string, chapter: string, part: number, flags: { perSlide?: boolean; autoFill?: boolean }): Promise<string[]> {
  const url = new URL(req.url);
  url.pathname = url.pathname.replace(/\/parts\/\d+\/render$/, `/parts/${part}/render`);
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ polish: true, ...flags }) });
  if (!res.ok) return [`part ${part}: polish failed (${res.status})`];
  const body = (await res.json()) as { polish?: string[] };
  return (body.polish ?? []).map((p) => `part ${part}: ${p}`);
}

export async function POST(req: Request, ctx: Ctx) {
  const { subject, chapter, part: partParam } = await ctx.params;
  const part = Number(partParam);
  try {
    const body = await req.json().catch(() => ({}));
    // Review's automatic fill: a per-slide polish, run once per part.
    if (body.autoFill) {
      const done = await fs.access(autoFillMarker(subject, chapter, part)).then(() => true, () => false);
      if (done) return NextResponse.json({ skipped: true });
      body.polish = true;
      body.perSlide = true;
    }
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
      // The part's real page count is what its last whole render produced; a part not flowed yet
      // holds fewer authored slides than pages, and the badge would read "Page 02 of 02".
      const rendered = await fs.readFile(path.join(outDir, 'render-report.json'), 'utf8').then((t) => Object.keys(JSON.parse(t)).length, () => 0);
      const r = await renderSlide(post, i, file, { pageCount: Math.max(post.slides.length, rendered) });
      // One slide is drawn where it stands: nothing reflows, so blocks the packer could not
      // fit are simply absent from the PNG. Say so — silently dropping them reads as content
      // loss, and rendering the whole part is what moves them onto the next page.
      const undrawn = r.spillIndexes.length
        ? [`${r.spillIndexes.length} block(s) did not fit on this page and were not drawn — render the whole part to flow them onto the next page`]
        : [];
      results = [{ slide: body.slide, overflowPx: r.overflowPx, fillPct: r.fillPct, file, warnings: [...r.warnings, ...undrawn], undrawn: r.spillIndexes.length }];
    } else {
      // Polish first fits every page that is over-long, before the flow turns it into a spill page
      // (a page can be over-long after an edit); the render below then draws the fitted pages.
      let fitted = 0;
      if (body.polish) {
        const { fitPlannedPages } = await import('@/lib/ai/plan');
        fitted = (await fitPlannedPages(subject, chapter, part)).condensed;
      }
      ({ results, split, followUp } = await renderWhole(subject, chapter, part, body.spillToFollowUp !== false));

      // Opt-in polish: densify the pages that came out thin, then rename any "(cont.)" pages.
      // Each step is an AI proposal applied and re-rendered; the golden rule is checked by pixels.
      if (body.polish) {
        const polish: string[] = fitted ? [`fitted ${fitted} over-long page(s)`] : [];
        const { densifySlides } = await import('@/lib/ai/plan');
        const minFill = categoryOf(await chapterCategory(subject, chapter).catch(() => undefined)).presentation.minFill;
        const thin = (rs: Results) => thinPages(rs, minFill);
        // Densifying can backfire: added content overflows onto a new page that is thinner
        // than the one we set out to fill. The pixels decide — an attempt that lowers the worst
        // fill on the part is undone and the pages we already had are put back.
        // `mustShrink`: a pull-back only counts when the part really lost the page it targeted.
        // `mustClear`: a condense only counts when the part has fewer clipped pages afterwards.
        const attempt = async (propose: () => Promise<Post>, mustShrink = false, mustClear = false) => {
          const before = {
            post: await loadPost(subject, chapter, part),
            worst: worstFill(results),
            pages: results.length,
            clipped: overflowing(results).length,
            spill: await snapshotFollowUps(subject, chapter, part),
          };
          let proposal: Post;
          try { proposal = await propose(); } catch { return false; } // a rejected proposal changes nothing
          await savePost(subject, chapter, part, proposal);
          ({ results, split, followUp } = await renderWhole(subject, chapter, part, body.spillToFollowUp !== false));
          if (worstFill(results) >= before.worst && (!mustShrink || results.length < before.pages) && (!mustClear || overflowing(results).length < before.clipped)) return true;
          await restoreFollowUps(subject, chapter, before.spill);
          await savePost(subject, chapter, part, before.post);
          ({ results, split, followUp } = await renderWhole(subject, chapter, part, body.spillToFollowUp !== false));
          return false;
        };
        // A clipped page is condensed first: the densify loop below only reads thin pages, and
        // nothing else would ever shrink a page that is too full. One try per page, each undone
        // alone if it does not clear the overflow or lowers the worst fill.
        const clipped = new Set<number>();
        let condensed = 0;
        for (let next = overflowing(results).find((r) => !clipped.has(r.slide)); next; next = overflowing(results).find((r) => !clipped.has(r.slide))) {
          clipped.add(next.slide);
          const { condenseSlide } = await import('@/lib/ai/plan');
          const need = next.fillPct;
          if (await attempt(() => condenseSlide(subject, chapter, part, next.slide, need), false, true)) condensed++;
        }
        if (clipped.size) polish.push(condensed ? `condensed ${condensed} overflowing page(s)${condensed < clipped.size ? `, ${clipped.size - condensed} rolled back` : ''}` : `condense rolled back for ${clipped.size} overflowing page(s)`);
        const under = thin(results).map((r) => ({ slide: r.slide, fillPct: r.fillPct }));
        if (under.length && body.perSlide) {
          // One page per call, so a page that backfires is undone alone and the rest keep
          // their fill. Each attempt reflows the part, so the next thin page is read off the
          // fresh render. A page that took its fill but is still thin gets one more try; one
          // that backfired gets one gentle try (a smaller ask of small blocks), since the same
          // ask would only spill again. The budget is the thin pages we started with, times
          // the tries each may take, so nothing loops.
          const tries = new Map<number, number>();
          const done = new Set<number>();
          const spilled = new Set<number>();
          const filled = new Set<number>();
          let undone = 0;
          let pulled = 0;
          for (let n = 0; n < under.length * PER_SLIDE_TRIES; n++) {
            const next = thin(results).find((r) => !done.has(r.slide));
            if (!next) break;
            const t = (tries.get(next.slide) ?? 0) + 1;
            tries.set(next.slide, t);
            if (t >= PER_SLIDE_TRIES) done.add(next.slide);
            // A page a spill made is where densify snowballs: filled, it spills again, and the
            // new page is thin in turn. Densify only grows authored pages; a spill page is pulled
            // back into its parent, condensed, or left as it is.
            const born = isContinuation((await loadPost(subject, chapter, part)).slides[next.slide - 1]?.page_title ?? '');
            if (born) {
              done.add(next.slide);
              if (next.slide > 1 && next.fillPct < 60) {
                const need = (results[next.slide - 2]?.fillPct ?? 100) + next.fillPct;
                const { pullBack } = await import('@/lib/ai/plan');
                if (await attempt(() => pullBack(subject, chapter, part, next.slide, need), true)) { pulled++; done.delete(next.slide); } // the next page now holds this number
              }
              continue;
            }
            const gentle = spilled.has(next.slide);
            const ask = [{ slide: next.slide, fillPct: next.fillPct, ...(gentle ? { gentle } : {}) }];
            if (await attempt(() => densifySlides(subject, chapter, part, ask))) filled.add(next.slide);
            else { undone++; spilled.add(next.slide); if (gentle) done.add(next.slide); }
          }
          polish.push(`densified ${filled.size} page(s) one at a time${undone ? `, ${undone} rolled back` : ''}${pulled ? `, ${pulled} pulled back` : ''}`);
        } else if (under.length) {
          polish.push(await attempt(() => densifySlides(subject, chapter, part, under))
            ? `densified ${under.length} page(s)`
            : `densify rolled back (worst fill ${worstFill(results)}% beat the attempt)`);
        }
        // Densify and pull-back add and move items, so the numbers are set again here, and the
        // pages redrawn when they changed (the numerals are in the PNGs).
        const { applyNumbering } = await import('@/lib/ai/numbering');
        const unnumbered = JSON.stringify((await loadPost(subject, chapter, part)).slides);
        if (JSON.stringify((await applyNumbering(subject, chapter, part)).slides) !== unnumbered) {
          ({ results, split, followUp } = await renderWhole(subject, chapter, part, body.spillToFollowUp !== false));
          polish.push('items renumbered');
        }
        // Renaming changes the titles, the re-render reflows, and the new split can mint a
        // fresh "(cont.)" page — so rename until the pages settle, twice at most.
        const { fixHeadings } = await import('@/lib/ai/headings');
        for (let pass = 0; pass < 2; pass++) {
          const now = await loadPost(subject, chapter, part);
          if (!now.slides.some((s) => isContinuation(s.page_title))) break;
          await savePost(subject, chapter, part, await fixHeadings(subject, chapter, part));
          // Spill here like every other render: a longer title can reflow the part onto an
          // eleventh page, and nothing after this pass would move it on.
          const renamed = await renderWhole(subject, chapter, part, body.spillToFollowUp !== false);
          results = renamed.results;
          followUp = renamed.followUp ?? followUp;
          polish.push(pass === 0 ? 'continuation titles rewritten' : 'continuation titles rewritten again after the reflow');
        }
        // Pull-backs and condenses can leave a small follow-up that nothing moves back: when both
        // parts fit one carousel, its pages return here and the part goes.
        if (body.spillToFollowUp !== false) {
          const { reclaimFollowUp } = await import('@/lib/ai/spillover');
          const back = await reclaimFollowUp(subject, chapter, part);
          if (back) {
            ({ results, split, followUp } = await renderWhole(subject, chapter, part, true));
            polish.push(`reclaimed part ${back.part}`);
          }
        }
        await writeReport(subject, chapter, part, results, true);
        if (body.autoFill) await fs.writeFile(autoFillMarker(subject, chapter, part), new Date().toISOString());
        // The parts this one spills into get polished the same way, so the whole chain (every
        // part, every "(cont.)" title) comes out finished from one click. They are read off
        // disk, not off the last render: a later render that did not spill (a rollback, a
        // rename) says nothing about the follow-up an earlier one fed, and it went unrendered.
        const fed = [...(await snapshotFollowUps(subject, chapter, part)).followUps.keys()];
        if (!followUp && fed.length) followUp = { moved: 0, part: fed[0] };
        if (body.polishFollowUps !== false) {
          for (const n of fed) polish.push(...(await polishChain(req, subject, chapter, n, { perSlide: body.perSlide, autoFill: body.autoFill })));
        }
        return NextResponse.json({ results, slides: results.length, split, followUp, polish });
      }
    }

    await writeReport(subject, chapter, part, results, typeof body.slide !== 'number');
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
