import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { attachAsset } from '@/lib/reel/shots';
import { loadReel } from '@/lib/reel/store';
import { reelDir } from '@/lib/paths';

type Ctx = { params: Promise<{ slug: string }> };
export const maxDuration = 300;

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
};

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

/** Streams one asset back to the studio player. */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const id = new URL(req.url).searchParams.get('id') ?? '';
  try {
    const reel = await loadReel(slug);
    const asset = reel.assets.find((a) => a.id === id);
    if (!asset?.path) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const file = path.join(reelDir(slug), asset.path);
    const buf = await fs.readFile(file);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}
