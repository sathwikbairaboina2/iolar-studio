import { promises as fs } from 'fs';
import { NextResponse } from 'next/server';
import path from 'path';
import { isSlug, launchRendersDir } from '@/lib/paths';

type Ctx = { params: Promise<{ slug: string }> };

/** The cover (a still of the hook headline), written with each render. */
export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'bad slug' }, { status: 400 });
  try {
    const bytes = await fs.readFile(path.join(launchRendersDir(slug), 'cover.png'));
    return new NextResponse(new Uint8Array(bytes), { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'no cover yet' }, { status: 404 });
  }
}
