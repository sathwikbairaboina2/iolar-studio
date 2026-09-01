import { NextResponse } from 'next/server';
import { readTrace } from '@/lib/reel/research/trace';

type Ctx = { params: Promise<{ slug: string }> };

/**
 * The researcher's log, live.
 *
 * The run route blocks for the length of a hunt, so the panel polls this while it waits
 * and draws each search and read as it lands — what is being looked for, where, right now.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  return NextResponse.json({ events: await readTrace(slug) });
}
