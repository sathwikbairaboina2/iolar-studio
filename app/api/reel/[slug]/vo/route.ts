import { NextResponse } from 'next/server';
import { reelVoFile } from '@/lib/paths';
import { serveMedia } from '@/lib/reel/serveMedia';

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    return await serveMedia(reelVoFile(slug), req);
  } catch {
    return NextResponse.json({ error: 'no voiceover yet' }, { status: 404 });
  }
}
