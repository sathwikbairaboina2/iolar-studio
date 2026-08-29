import { NextResponse } from 'next/server';
import { packagePost } from '@/lib/packageExport';

type Ctx = { params: Promise<{ subject: string; chapter: string; part: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const { subject, chapter, part } = await ctx.params;
  try {
    return NextResponse.json(await packagePost(subject, chapter, Number(part)));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}
