import { NextResponse } from 'next/server';
import path from 'path';
import { explainer2RendersDir, isSlug } from '@/lib/paths';
import { readJob } from '@/lib/explainer2/store';
import { streamMp4 } from '@/lib/explainer/streamMp4';

type Ctx = { params: Promise<{ slug: string }> };

/** The newest render's mp4, named by the job's renderId. */
export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'bad slug' }, { status: 400 });
  const job = await readJob(slug);
  if (!job?.renderId || !/^[0-9a-f]{12}$/.test(job.renderId)) return NextResponse.json({ error: 'not rendered yet' }, { status: 404 });
  return streamMp4(path.join(explainer2RendersDir(slug), `${job.renderId}.mp4`));
}
