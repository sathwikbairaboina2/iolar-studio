import { NextResponse } from 'next/server';
import { planFromReference, planFromScript, planFromTopic } from '@/lib/ai/reel/plan';

type Ctx = { params: Promise<{ slug: string }> };
export const maxDuration = 900;

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  try {
    const reel =
      body.mode === 'paste'
        ? await planFromScript(slug, String(body.script ?? ''))
        : body.mode === 'reference'
          ? await planFromReference(slug, String(body.mediaUrl ?? ''))
          : await planFromTopic(slug, String(body.topic ?? ''));
    return NextResponse.json({ reel });
  } catch (err) {
    const msg = String(err);
    const status = /Claude CLI not found|Whisper is not installed/.test(msg) ? 503 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
