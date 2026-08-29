import { NextResponse } from 'next/server';
import { packagePost } from '@/lib/packageExport';

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    return NextResponse.json(await packagePost(slug));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}
