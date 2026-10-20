import { NextResponse } from 'next/server';
import { isSlug } from '@/lib/paths';
import { changeBed, isRunning } from '@/lib/explainer2/job';
import { musicBeds, readManifest } from '@/lib/explainer2/sound';
import { AlreadyRunning, startRun } from '@/lib/explainer2/start';
import { readJob } from '@/lib/explainer2/store';
import { renderRoot } from '@/lib/explainer2/workspace';

type Ctx = { params: Promise<{ slug: string }> };

/** A person picks another music bed (or none) from the library. Only the render is redone. */
export async function POST(req: Request, { params }: Ctx) {
  const { slug } = await params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'bad slug' }, { status: 400 });
  if (!(await readJob(slug))) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { bed?: unknown };
  const bed = body.bed === null ? null : typeof body.bed === 'string' ? body.bed : undefined;
  if (bed === undefined) return NextResponse.json({ error: 'bed must be a library file or null' }, { status: 400 });
  if (bed !== null) {
    const beds = musicBeds((await readManifest(renderRoot())) ?? []).map((b) => b.file);
    if (!beds.includes(bed)) return NextResponse.json({ error: 'that bed is not in the library' }, { status: 400 });
  }
  if (isRunning(slug)) return NextResponse.json({ error: `${slug} is already running` }, { status: 409 });
  await changeBed(slug, bed);
  try {
    await startRun(slug);
  } catch (err) {
    if (err instanceof AlreadyRunning) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }
  return NextResponse.json({ started: true }, { status: 202 });
}
