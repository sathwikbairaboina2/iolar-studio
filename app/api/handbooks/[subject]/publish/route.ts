import { NextResponse } from 'next/server';
import { existsSync } from 'fs';
import { chapterDir, isSlug } from '@/lib/paths';
import { loadSubject } from '@/lib/store';
import { exportSubject } from '@/lib/publish/export';
import { chapterHash } from '@/lib/publish/hash';
import { editionHash, loadEdition } from '@/lib/digital/edition';
import { readJob, startPublish } from '@/lib/publish/job';
import { checkOrder } from '@/lib/publish/order';
import { liveChapters, queue, readState, updateState } from '@/lib/publish/state';

type Ctx = { params: Promise<{ subject: string }> };

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

async function snapshot(subject: string) {
  const state = await readState(subject);
  // A chapter edited after its review is not live until it is reviewed again.
  const stale: string[] = [];
  // Section title of every page, in page order, so a finding's page number can name its section.
  const editions: Record<string, string[]> = {};
  for (const [slug, c] of Object.entries(state.chapters)) {
    const edition = await loadEdition(subject, slug);
    if (edition) editions[slug] = edition.sections.flatMap((s) => s.pages.map(() => s.title));
    const changed = !!c.hash && (await chapterHash(subject, slug).catch(() => null)) !== c.hash;
    const swapped = !!c.editionHash && (!edition || editionHash(edition) !== c.editionHash);
    if (changed || swapped) stale.push(slug);
  }
  return {
    state,
    job: await readJob(subject),
    queue: queue(state),
    live: liveChapters(state).filter((s) => !stale.includes(s)),
    stale,
    editions,
  };
}

export async function GET(_req: Request, ctx: Ctx) {
  const { subject } = await ctx.params;
  if (!isSlug(subject)) return bad('bad subject', 400);
  try {
    await loadSubject(subject);
  } catch {
    return bad('subject not found', 404);
  }
  return NextResponse.json(await snapshot(subject));
}

function slugList(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((x) => typeof x === 'string' && isSlug(x)) ? (v as string[]) : null;
}

export async function POST(req: Request, ctx: Ctx) {
  const { subject } = await ctx.params;
  if (!isSlug(subject)) return bad('bad subject');
  try {
    await loadSubject(subject);
  } catch {
    return bad('subject not found', 404);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad('body must be JSON');
  }
  const exists = (c: string) => existsSync(chapterDir(subject, c));

  try {
    switch (body.action) {
      case 'run': {
        const chapters = slugList(body.chapters);
        if (!chapters?.length) return bad('chapters must be a list of chapter slugs');
        if (!chapters.every(exists)) return bad('unknown chapter', 404);
        try {
          return NextResponse.json({ job: await startPublish(subject, [...new Set(chapters)]) });
        } catch (err) {
          if (err instanceof Error && err.message === 'busy') return bad('a publish run is already live for this subject', 409);
          throw err;
        }
      }
      case 'regenerate': {
        const chapter = body.chapter;
        if (typeof chapter !== 'string' || !isSlug(chapter)) return bad('chapter must be a slug');
        if (!exists(chapter)) return bad('unknown chapter', 404);
        const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
        if (!notes) return bad('notes must say what to change');
        if (notes.length > 4000) return bad('notes are too long');
        try {
          return NextResponse.json({ job: await startPublish(subject, [chapter], { notes: { [chapter]: notes } }) });
        } catch (err) {
          if (err instanceof Error && err.message === 'busy') return bad('a publish run is already live for this subject', 409);
          throw err;
        }
      }
      case 'unselect': {
        const chapters = slugList(body.chapters);
        if (!chapters) return bad('chapters must be a list of chapter slugs');
        if (!chapters.every(exists)) return bad('unknown chapter', 404);
        await updateState(subject, (s) => {
          for (const c of chapters) s.chapters[c] = { ...s.chapters[c], selected: false };
        });
        await exportSubject(subject);
        return NextResponse.json(await snapshot(subject));
      }
      case 'approve':
      case 'reject': {
        const chapter = body.chapter;
        if (typeof chapter !== 'string' || !isSlug(chapter)) return bad('chapter must be a slug');
        if (!exists(chapter)) return bad('unknown chapter', 404);
        const problem = await updateState(subject, (s) => {
          const c = s.chapters[chapter];
          if (!c?.verdict) return 'this chapter has not been reviewed yet';
          if (body.action === 'approve') {
            if (c.verdict === 'fail') return 'a chapter that failed review cannot be approved';
            c.approvedBy = 'human';
            c.approvedAt = new Date().toISOString();
            c.selected = true;
            delete c.rejected;
          } else {
            c.rejected = true;
          }
          return null;
        });
        if (problem) return bad(problem);
        await exportSubject(subject);
        return NextResponse.json(await snapshot(subject));
      }
      case 'order': {
        const order = slugList(body.order);
        if (!order) return bad('order must be a list of chapter slugs');
        const problem = await updateState(subject, (s) => {
          if (!s.order) return 'there is no proposed order to change yet';
          const problems = checkOrder(order, s.order.prerequisites, s.order.order);
          if (problems.length) return problems.join('; ');
          s.order = { ...s.order, order, approvedBy: 'human' };
          return null;
        });
        if (problem) return bad(problem);
        await exportSubject(subject);
        return NextResponse.json(await snapshot(subject));
      }
      case 'alwaysAsk': {
        if (typeof body.value !== 'boolean') return bad('value must be true or false');
        await updateState(subject, (s) => { s.alwaysAsk = body.value as boolean; });
        return NextResponse.json(await snapshot(subject));
      }
      default:
        return bad('unknown action');
    }
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
