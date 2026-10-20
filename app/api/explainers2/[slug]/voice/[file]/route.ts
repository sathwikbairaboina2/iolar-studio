import { promises as fs } from 'fs';
import { NextResponse } from 'next/server';
import path from 'path';
import { explainer2VoiceDir, isSlug } from '@/lib/paths';

type Ctx = { params: Promise<{ slug: string; file: string }> };

/** One voice clip, by file name only (b1.mp3), never a path. */
export async function GET(_req: Request, { params }: Ctx) {
  const { slug, file } = await params;
  if (!isSlug(slug) || !/^[a-z0-9-]+\.mp3$/.test(file)) return NextResponse.json({ error: 'bad name' }, { status: 400 });
  try {
    const bytes = await fs.readFile(path.join(explainer2VoiceDir(slug), file));
    return new NextResponse(new Uint8Array(bytes), { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}
