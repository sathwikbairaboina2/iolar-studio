import { NextResponse } from 'next/server';
import { assemble } from '@/lib/reel/assemble';
import { loadStyle } from '@/lib/reel/styles';
import { loadReel, saveReel } from '@/lib/reel/store';

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    const reel = await loadReel(slug);
    const style = await loadStyle(reel.style);
    const next = { ...reel, timeline: assemble({ reel, style }) };
    await saveReel(slug, next);
    return NextResponse.json({ reel: next });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
