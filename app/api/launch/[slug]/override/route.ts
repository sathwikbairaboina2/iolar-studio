import { NextResponse } from 'next/server';
import { isSlug } from '@/lib/paths';
import { readJob } from '@/lib/launch/store';
import { LaunchAlreadyRunning, startLaunchOverride } from '@/lib/launch/start';

type Ctx = { params: Promise<{ slug: string }> };

/** A person accepts the fact-check issues that remain; the job carries on to approval. */
export async function POST(_req: Request, { params }: Ctx) {
  const { slug } = await params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'bad slug' }, { status: 400 });
  if (!(await readJob(slug))) return NextResponse.json({ error: 'not found' }, { status: 404 });
  try {
    await startLaunchOverride(slug);
  } catch (err) {
    if (err instanceof LaunchAlreadyRunning) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }
  return NextResponse.json({ started: true }, { status: 202 });
}
