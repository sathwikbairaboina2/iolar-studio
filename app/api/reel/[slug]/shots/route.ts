import { NextResponse } from 'next/server';
import { abandonShot, recastShot, refreshShots, retryShot, runShots } from '@/lib/reel/shots';
// Registers the renderers. Without it the registry is empty in whichever
// process reaches this route first, and every job stays running forever.
import '@/lib/reel/providers';

type Ctx = { params: Promise<{ slug: string }> };
export const maxDuration = 900;

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  try {
    // `beatIds` is the gate's answer: render these and nothing else. An absent list is an
    // unreviewed run, which still queues the whole plan.
    const beatIds = Array.isArray(body.beatIds) ? body.beatIds.map(String) : undefined;
    const beatId = body.beatId ? String(body.beatId) : null;
    const action = String(body.action ?? 'retry');

    // Recovering one stuck beat is not the same request as rendering the reel, and only
    // the retry path may queue anything.
    const reel = beatId
      ? action === 'recast'
        ? await recastShot(slug, beatId, String(body.kind) as never)
        : action === 'abandon'
          ? await abandonShot(slug, beatId, String(body.why ?? 'abandoned in the studio'))
          : await retryShot(slug, beatId, body.brief ? String(body.brief) : undefined)
      : await runShots(slug, beatIds);
    return NextResponse.json({ reel });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/** Polled by the studio: advances running provider jobs and returns the reel. */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    return NextResponse.json({ reel: await refreshShots(slug) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
