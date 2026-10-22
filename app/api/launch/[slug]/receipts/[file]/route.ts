import { promises as fs } from 'fs';
import { NextResponse } from 'next/server';
import path from 'path';
import { isSlug, launchAssetsDir } from '@/lib/paths';

type Ctx = { params: Promise<{ slug: string; file: string }> };

/** One receipt screenshot, by file name only (receipt-c3.png), never a path. */
export async function GET(_req: Request, { params }: Ctx) {
  const { slug, file } = await params;
  if (!isSlug(slug) || !/^receipt-c\d+\.png$/.test(file)) return NextResponse.json({ error: 'bad name' }, { status: 400 });
  try {
    const bytes = await fs.readFile(path.join(launchAssetsDir(slug), file));
    return new NextResponse(new Uint8Array(bytes), { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}
