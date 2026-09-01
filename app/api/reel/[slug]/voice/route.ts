import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { alignExistingVoice, synthesizeVoice } from '@/lib/reel/voice';
import { voScript, scriptWordCount, voMatchesScript } from '@/lib/reel/script';
import { loadReel } from '@/lib/reel/store';
import { reelVoFile } from '@/lib/paths';
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
    if (err instanceof WhisperUnavailableError) {
      return NextResponse.json({ error: String(err) }, { status: 503 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * Where the voiceover stands, for the panel that offers to change it.
 *
 * The script comes back with it so a creator copying it into their own voice tool pastes
 * the same string the aligner will be given — a paraphrase there costs every word timing.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    const reel = await loadReel(slug);
    const bytes = await fs
      .stat(reelVoFile(slug))
      .then((s) => s.size)
      .catch(() => 0);
    return NextResponse.json({
      hasAudio: bytes > 0,
      bytes,
      aligned: reel.vo.words.length > 0,
      durationSec: reel.vo.durationSec,
      heardWords: reel.vo.words.length,
      scriptWords: scriptWordCount(reel),
      // A take from before takes were fingerprinted cannot be judged either way. Saying
      // "stale" there would cry wolf on every reel already built.
      matchesScript: reel.vo.scriptHash ? voMatchesScript(reel) : null,
      script: voScript(reel),
      provider: reel.vo.provider ?? null,
      voiceId: reel.vo.voiceId ?? null,
    });
  } catch {
    return NextResponse.json({ error: 'no such reel' }, { status: 404 });
  }
}
