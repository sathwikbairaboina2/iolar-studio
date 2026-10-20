import { NextResponse } from 'next/server';
import { isSlug } from '@/lib/paths';
import { STAGES, type Stage } from '@/lib/explainer2/schema';
import { readJob } from '@/lib/explainer2/store';
import { AlreadyRunning, startRun } from '@/lib/explainer2/start';

type Ctx = { params: Promise<{ slug: string }> };

/** Runs the pending stages (or from / only one stage) in the background. Answers at once; the page polls the detail. */
export async function POST(req: Request, { params }: Ctx) {
  const { slug } = await params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'bad slug' }, { status: 400 });
  if (!(await readJob(slug))) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { from?: string; only?: string };
  const known = (s?: string): s is Stage => !!s && (STAGES as readonly string[]).includes(s);
  const opts = { ...(known(body.from) ? { from: body.from } : {}), ...(known(body.only) ? { only: body.only } : {}) };
  try {
    await startRun(slug, opts);
  } catch (err) {
    if (err instanceof AlreadyRunning) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }
  return NextResponse.json({ started: true }, { status: 202 });
}
