import { NextResponse } from 'next/server';
import { explainerMp4, explainerRenderMp4, isSlug } from '@/lib/paths';
import { latestDone } from '@/lib/explainer/renders';
import { streamMp4 } from '@/lib/explainer/streamMp4';

/** The newest render there is an mp4 for, at the same address the page has always used. */

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'bad slug' }, { status: 400 });

  const newest = await latestDone(slug);
  // An explainer rendered before renders were jobs has a `reel.mp4` and no log. It still plays.
  return streamMp4(newest ? explainerRenderMp4(slug, newest.id) : explainerMp4(slug));
}
