import { createReadStream, promises as fs } from 'fs';
import { Readable } from 'stream';
import { NextResponse } from 'next/server';
import { explainerMp4 } from '@/lib/paths';
import { isSlug } from '@/lib/paths';

/** The rendered reel, streamed from beside the document so the page can just play it. */

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'bad slug' }, { status: 400 });

  const file = explainerMp4(slug);
  const stat = await fs.stat(file).catch(() => null);
  if (!stat) return NextResponse.json({ error: 'not rendered yet' }, { status: 404 });

  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      'content-type': 'video/mp4',
      'content-length': String(stat.size),
      'cache-control': 'no-store',
    },
  });
}
