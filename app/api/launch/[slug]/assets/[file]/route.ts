import { promises as fs } from 'fs';
import { NextResponse } from 'next/server';
import path from 'path';
import { isSlug, launchAssetsDir } from '@/lib/paths';

type Ctx = { params: Promise<{ slug: string; file: string }> };

/** The anchor-reel files a reel page shows: avatar clips, b-roll photos and demo clips, by file name only, never a path. */
const NAME = /^(?:(avatar-\d+|demo-[1-3])\.mp4|(broll-\d+)\.png)$/;

export async function GET(_req: Request, { params }: Ctx) {
  const { slug, file } = await params;
  const m = NAME.exec(file);
  if (!isSlug(slug) || !m) return NextResponse.json({ error: 'bad name' }, { status: 400 });
  try {
    const bytes = await fs.readFile(path.join(launchAssetsDir(slug), file));
    return new NextResponse(new Uint8Array(bytes), { headers: { 'content-type': m[2] ? 'image/png' : 'video/mp4', 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}
