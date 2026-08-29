import { NextResponse } from 'next/server';
import { assemble } from '@/lib/reel/assemble';
import { loadPattern } from '@/lib/reel/patterns';
import { loadReel, saveReel } from '@/lib/reel/store';

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    const reel = await loadReel(slug);
    const pattern = await loadPattern(reel.pattern);
    const next = { ...reel, timeline: assemble({ reel, pattern }) };
    await saveReel(slug, next);
    return NextResponse.json({ reel: next });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
