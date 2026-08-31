import { NextResponse } from 'next/server';
import { advanceBuild, buildAll, buildState, type VoiceSource } from '@/lib/reel/build/run';

type Ctx = { params: Promise<{ slug: string }> };

/**
 * Building a reel is minutes of other people's machines, so it gets the same
 * treatment as research: one call advances one stage, the state is derived from
 * disk, and `auto` is a caller asking for the loop rather than a second path.
 */
export const maxDuration = 960;

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    return NextResponse.json(await buildState(slug));
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 404 });
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const voice: VoiceSource = body.voice === 'tts' ? 'tts' : 'supplied';

  try {
    const state = body.auto === false ? await advanceBuild(slug, voice) : await buildAll(slug, voice);
    return NextResponse.json(state);
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}
