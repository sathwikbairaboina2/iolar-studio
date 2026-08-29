import { NextResponse } from 'next/server';
import { deleteReel, loadReel, saveReel } from '@/lib/reel/store';
import { validateReel } from '@/lib/reel/schema';

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    return NextResponse.json({ reel: await loadReel(slug) });
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  let reel;
  try {
    reel = validateReel(body.reel);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
  try {
    await saveReel(slug, reel);
    return NextResponse.json({ reel });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  await deleteReel(slug);
  return NextResponse.json({ ok: true });
}
