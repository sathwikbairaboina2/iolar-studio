import { NextResponse } from 'next/server';
import { explainerRenderMp4, isSlug } from '@/lib/paths';
import { streamMp4 } from '@/lib/explainer/streamMp4';

/** One particular render, so two takes of the same board can be watched one after the other. */

type Ctx = { params: Promise<{ slug: string; id: string }> };

const isJobId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id);

export async function GET(_req: Request, { params }: Ctx) {
  const { slug, id } = await params;
  if (!isSlug(slug) || !isJobId(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  return streamMp4(explainerRenderMp4(slug, id));
}
