import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { reelVoFile } from '@/lib/paths';

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    const buf = await fs.readFile(reelVoFile(slug));
    return new NextResponse(new Uint8Array(buf), {
      headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ error: 'no voiceover yet' }, { status: 404 });
  }
}
