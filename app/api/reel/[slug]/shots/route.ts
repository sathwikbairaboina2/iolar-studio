import { NextResponse } from 'next/server';
import { refreshShots, retryShot, runShots } from '@/lib/reel/shots';

type Ctx = { params: Promise<{ slug: string }> };
export const maxDuration = 900;

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  try {
    const reel = body.beatId
      ? await retryShot(slug, String(body.beatId), body.brief ? String(body.brief) : undefined)
      : await runShots(slug);
    return NextResponse.json({ reel });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/** Polled by the studio: advances running ComfyUI jobs and returns the reel. */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    return NextResponse.json({ reel: await refreshShots(slug) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
