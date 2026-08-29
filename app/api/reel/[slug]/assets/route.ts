import { NextResponse } from 'next/server';
import path from 'path';
import { attachAsset } from '@/lib/reel/shots';
import { loadReel } from '@/lib/reel/store';
import { reelDir } from '@/lib/paths';
import { serveMedia } from '@/lib/reel/serveMedia';

type Ctx = { params: Promise<{ slug: string }> };
export const maxDuration = 300;

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    const form = await req.formData();
    const file = form.get('file');
    const beatId = String(form.get('beatId') ?? '');
    if (!(file instanceof File) || !beatId) {
      return NextResponse.json({ error: 'file and beatId required' }, { status: 400 });
    }
    const reel = await attachAsset(slug, beatId, {
      name: file.name,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    return NextResponse.json({ reel });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/** Streams one asset back to the studio player, with range support so it can seek. */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const id = new URL(req.url).searchParams.get('id') ?? '';
  try {
    const reel = await loadReel(slug);
    const asset = reel.assets.find((a) => a.id === id);
    if (!asset?.path) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return serveMedia(path.join(reelDir(slug), asset.path), req);
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}
