import { NextResponse } from 'next/server';
import { isSlug } from '@/lib/paths';
import { readJob } from '@/lib/launch/store';
import { LaunchAlreadyRunning, startApprove } from '@/lib/launch/start';

type Ctx = { params: Promise<{ slug: string }> };

/** A person approves the script as it stands; the job carries on to voice, edit, receipts and the render. */
export async function POST(_req: Request, { params }: Ctx) {
  const { slug } = await params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'bad slug' }, { status: 400 });
  if (!(await readJob(slug))) return NextResponse.json({ error: 'not found' }, { status: 404 });
  try {
    await startApprove(slug);
  } catch (err) {
    if (err instanceof LaunchAlreadyRunning) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }
  return NextResponse.json({ started: true }, { status: 202 });
}
