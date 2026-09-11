import { createReadStream, promises as fs } from 'fs';
import { Readable } from 'stream';
import { NextResponse } from 'next/server';

/** One mp4, streamed off disk. Range requests are not handled; the page plays it whole. */
export async function streamMp4(file: string) {
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
