import { NextResponse } from 'next/server';
import { loadReel } from '@/lib/reel/store';
import { retryShot } from '@/lib/reel/shots';
import { reviewOf } from '@/lib/reel/providers/webpage';
import { queueDepth } from '@/lib/reel/providers/lipsync';
import { resolveLink } from '@/lib/reel/build/links';
import * as research from '@/lib/reel/research/store';
import '@/lib/reel/providers';

type Ctx = { params: Promise<{ slug: string }> };

/**
 * What one renderer is doing on this reel.
 *
 * The reel is the record of which asset belongs to which beat and which
 * renderer made it; the plugin is asked only for the things it alone knows —
 * its queue depth, and its own verdict on a finished page clip. A board that
 * showed the plugin's job list instead would lose the beat each job is for.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const provider = new URL(req.url).searchParams.get('provider') ?? 'webpage';

  try {
    const reel = await loadReel(slug);
    const script = await research.readScript(slug).catch(() => null);
    const pack = await research.readCandidates(slug).catch(() => null);

    const jobs = await Promise.all(
      reel.beats
        .map((beat) => ({ beat, asset: reel.assets.find((a) => a.id === beat.shot.assetId) }))
        .filter(({ asset }) => asset?.provider === provider)
        .map(async ({ beat, asset }) => {
          const link =
            provider === 'webpage' && script && pack
              ? resolveLink(script, pack.candidates, beat.shot.sourceLineId)
              : null;
          // Only a finished page clip has a review to report.
          const review =
            provider === 'webpage' && asset!.status === 'ready' && asset!.jobId
              ? await reviewOf(asset!.jobId)
              : null;

          return {
            assetId: asset!.id,
            beatId: beat.id,
            status: asset!.status,
            jobId: asset!.jobId,
            error: asset!.error,
            brief: asset!.brief,
            durationSec: asset!.durationSec,
            url: link?.url,
            highlight: link?.highlight,
            review,
          };
        })
    );

    const queue = provider === 'lipsync' ? await queueDepth() : null;
    return NextResponse.json({ jobs, queue });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 404 });
  }
}

/** Re-queues one beat. One bad shot in twelve should cost one shot. */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  if (!body.beatId) return NextResponse.json({ error: 'which beat?' }, { status: 400 });

  try {
    const reel = await retryShot(slug, String(body.beatId));
    return NextResponse.json({ ok: true, assets: reel.assets.length });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}
