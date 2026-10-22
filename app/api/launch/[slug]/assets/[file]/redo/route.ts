import { NextResponse } from 'next/server';
import { isSlug } from '@/lib/paths';
import { dropAsset } from '@/lib/launch/assets';
import { LaunchAlreadyRunning, startLaunch } from '@/lib/launch/start';
import { isLaunchRunning } from '@/lib/launch/job';

type Ctx = { params: Promise<{ slug: string; file: string }> };

/** An asset id (avatar-3, broll-0, demo-1, post-2) or the file it made (avatar-3.mp4); anything else is refused. */
const ASSET = /^((?:avatar|broll)-\d+|(?:demo|post)-[1-3])(?:\.(?:mp4|png))?$/;

/** Makes one asset again: deletes its file and record, then runs the assets stage and everything after it. */
export async function POST(_req: Request, { params }: Ctx) {
  const { slug, file } = await params;
  const m = ASSET.exec(file);
  if (!isSlug(slug) || !m) return NextResponse.json({ error: 'bad name' }, { status: 400 });
  if (isLaunchRunning(slug)) return NextResponse.json({ error: `${slug} is already running` }, { status: 409 });
  if (!(await dropAsset(slug, m[1]))) return NextResponse.json({ error: 'no such asset' }, { status: 404 });
  try {
    await startLaunch(slug, { from: 'assets' });
  } catch (err) {
    if (err instanceof LaunchAlreadyRunning) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }
  return NextResponse.json({ started: true }, { status: 202 });
}
