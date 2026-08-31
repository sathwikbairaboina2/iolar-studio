import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { reelVoFile } from '@/lib/paths';
import { serveMedia } from '@/lib/reel/serveMedia';

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    return await serveMedia(reelVoFile(slug), req);
  } catch {
    return NextResponse.json({ error: 'no voiceover yet' }, { status: 404 });
  }
}

/**
 * Takes the voiceover the user recorded.
 *
 * Stored unaligned: whisper places the words in a separate pass, so an upload
 * that arrives while alignment is unavailable still keeps the audio. Replacing
 * the file does not clear the old word timings — the build's next stage
 * realigns, and a half-cleared reel is worse than a stale one.
 */
export async function PUT(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.length === 0) {
    return NextResponse.json({ error: 'no audio in the request body' }, { status: 400 });
  }

  const dest = reelVoFile(slug);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, bytes);
  return NextResponse.json({ ok: true, bytes: bytes.length });
}
