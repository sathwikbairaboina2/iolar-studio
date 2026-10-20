import { NextResponse } from 'next/server';
import { isSlug } from '@/lib/paths';
import { readJob } from '@/lib/explainer2/store';
import { AlreadyRunning, startOverride } from '@/lib/explainer2/start';

type Ctx = { params: Promise<{ slug: string }> };

/** A person accepts the fact-check issues that remain; the job carries on to voice, design and render. */
export async function POST(_req: Request, { params }: Ctx) {
  const { slug } = await params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'bad slug' }, { status: 400 });
  if (!(await readJob(slug))) return NextResponse.json({ error: 'not found' }, { status: 404 });
  try {
    await startOverride(slug);
  } catch (err) {
    if (err instanceof AlreadyRunning) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }
  return NextResponse.json({ started: true }, { status: 202 });
}
