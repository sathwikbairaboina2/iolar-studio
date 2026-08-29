import { NextResponse } from 'next/server';
import { polishPost } from '@/lib/comfy/polish';
import { getStats } from '@/lib/comfy/client';

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    if (!(await getStats()).up) {
      return NextResponse.json({ error: 'comfyui offline' }, { status: 503 });
    }
    return NextResponse.json(await polishPost(slug));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
