import { NextResponse } from 'next/server';
import { alignExistingVoice, synthesizeVoice } from '@/lib/reel/voice';
import { HiggsfieldUnavailableError } from '@/lib/higgsfield/client';
import { WhisperUnavailableError } from '@/lib/reel/align';

type Ctx = { params: Promise<{ slug: string }> };
export const maxDuration = 900;

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  try {
    const reel = body.alignOnly ? await alignExistingVoice(slug) : await synthesizeVoice(slug);
    return NextResponse.json({ reel });
  } catch (err) {
    if (err instanceof HiggsfieldUnavailableError || err instanceof WhisperUnavailableError) {
      return NextResponse.json({ error: String(err) }, { status: 503 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
