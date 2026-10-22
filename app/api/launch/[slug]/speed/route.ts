import { NextResponse } from 'next/server';
import { isSlug } from '@/lib/paths';
import { isLaunchRunning } from '@/lib/launch/job';
import { readBrief, writeBrief } from '@/lib/launch/store';

type Ctx = { params: Promise<{ slug: string }> };

/** Sets the brief's speed (`fast` or `polish`). It only records the choice; running the critic is a separate call. */
export async function POST(req: Request, { params }: Ctx) {
  const { slug } = await params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'bad slug' }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { speed?: string };
  if (body.speed !== 'fast' && body.speed !== 'polish') return NextResponse.json({ error: 'speed must be fast or polish' }, { status: 400 });
  const brief = await readBrief(slug);
  if (!brief) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (isLaunchRunning(slug)) return NextResponse.json({ error: `${slug} is already running` }, { status: 409 });
  await writeBrief(slug, { ...brief, speed: body.speed });
  return NextResponse.json({ speed: body.speed });
}
