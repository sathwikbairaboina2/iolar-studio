import { NextResponse } from 'next/server';
import { isSlug, reelPresenterFile } from '@/lib/paths';
import { serveMedia } from '@/lib/reel/serveMedia';
import { clearUploadedPresenter, presenterState, saveUploadedPresenter } from '@/lib/reel/pattern/presenter';

type Ctx = { params: Promise<{ slug: string }> };
const MAX_BYTES = 100 * 1024 * 1024;

/** The hook clip itself, or with `?state` where the presenter stands. */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'bad reel id' }, { status: 400 });
  if (new URL(req.url).searchParams.get('state') !== null) return NextResponse.json(await presenterState(slug));
  try {
    return await serveMedia(reelPresenterFile(slug), req);
  } catch {
    return NextResponse.json({ error: 'no hook clip yet' }, { status: 404 });
  }
}

/** The user's own hook clip; it wins over the lipsync render. */
export async function PUT(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'bad reel id' }, { status: 400 });
  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.length === 0) return NextResponse.json({ error: 'no video in the request body' }, { status: 400 });
  if (bytes.length > MAX_BYTES) return NextResponse.json({ error: 'that clip is too large' }, { status: 413 });
  try {
    await saveUploadedPresenter(slug, bytes);
    return NextResponse.json({ ok: true, bytes: bytes.length });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'bad reel id' }, { status: 400 });
  await clearUploadedPresenter(slug);
  return NextResponse.json({ ok: true });
}
