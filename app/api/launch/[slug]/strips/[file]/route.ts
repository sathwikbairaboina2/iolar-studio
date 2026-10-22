import { promises as fs } from 'fs';
import { NextResponse } from 'next/server';
import path from 'path';
import { isSlug, launchFile } from '@/lib/paths';

type Ctx = { params: Promise<{ slug: string; file: string }> };

/** One critic strip, by file name only (00-Headline.png), never a path. */
export async function GET(_req: Request, { params }: Ctx) {
  const { slug, file } = await params;
  if (!isSlug(slug) || !/^\d{2}-[A-Za-z]+\.png$/.test(file)) return NextResponse.json({ error: 'bad name' }, { status: 400 });
  try {
    const bytes = await fs.readFile(path.join(launchFile(slug, 'strips'), file));
    return new NextResponse(new Uint8Array(bytes), { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}
