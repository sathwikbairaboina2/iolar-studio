import { NextResponse } from 'next/server';
import { polishPost } from '@/lib/comfy/polish';
import { getStats } from '@/lib/comfy/client';

type Ctx = { params: Promise<{ subject: string; chapter: string; part: string }> };

export const maxDuration = 900;

export async function POST(_req: Request, ctx: Ctx) {
  const { subject, chapter, part } = await ctx.params;
  try {
    if (!(await getStats()).up) {
      return NextResponse.json({ error: 'comfyui offline' }, { status: 503 });
    }
    return NextResponse.json(await polishPost(subject, chapter, Number(part)));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
