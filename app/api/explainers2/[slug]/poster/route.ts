import { promises as fs } from 'fs';
import { NextResponse } from 'next/server';
import path from 'path';
import { explainer2RendersDir, isSlug } from '@/lib/paths';

type Ctx = { params: Promise<{ slug: string }> };

/** The cover (a still at the hook's peak), written with each render; a render from before covers existed has only `poster.png`. */
export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'bad slug' }, { status: 400 });
  for (const name of ['cover.png', 'poster.png']) {
    try {
      const bytes = await fs.readFile(path.join(explainer2RendersDir(slug), name));
      return new NextResponse(new Uint8Array(bytes), { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } });
    } catch {
      // try the next name
    }
  }
  return NextResponse.json({ error: 'no poster yet' }, { status: 404 });
}
