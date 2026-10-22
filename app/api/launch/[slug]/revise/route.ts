import { NextResponse } from 'next/server';
import { isSlug } from '@/lib/paths';
import { readJob } from '@/lib/launch/store';
import { LaunchAlreadyRunning, startLaunchRevise } from '@/lib/launch/start';

type Ctx = { params: Promise<{ slug: string }> };

/** Revision notes: `wording` rewrites the script (and asks for approval again); `visual` only redoes the edit list. */
export async function POST(req: Request, { params }: Ctx) {
  const { slug } = await params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'bad slug' }, { status: 400 });
  if (!(await readJob(slug))) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { notes?: string; kind?: string };
  const notes = (body.notes ?? '').trim();
  if (!notes) return NextResponse.json({ error: 'notes are required' }, { status: 400 });
  const kind = body.kind === 'wording' ? 'wording' : 'visual';
  try {
    await startLaunchRevise(slug, notes, kind);
  } catch (err) {
    if (err instanceof LaunchAlreadyRunning) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }
  return NextResponse.json({ started: true }, { status: 202 });
}
