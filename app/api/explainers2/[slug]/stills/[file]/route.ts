import { promises as fs } from 'fs';
import { NextResponse } from 'next/server';
import path from 'path';
import { explainer2StillsDir, isSlug } from '@/lib/paths';

type Ctx = { params: Promise<{ slug: string; file: string }> };

/** One beat still, by file name only (b1.png), never a path. */
export async function GET(_req: Request, { params }: Ctx) {
  const { slug, file } = await params;
  if (!isSlug(slug) || !/^[a-z0-9-]+\.png$/.test(file)) return NextResponse.json({ error: 'bad name' }, { status: 400 });
  try {
    const bytes = await fs.readFile(path.join(explainer2StillsDir(slug), file));
    return new NextResponse(new Uint8Array(bytes), { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}
