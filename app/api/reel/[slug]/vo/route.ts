import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { isSlug, reelVoFile } from '@/lib/paths';
import { loadReel, saveReel } from '@/lib/reel/store';
import { serveMedia } from '@/lib/reel/serveMedia';

type Ctx = { params: Promise<{ slug: string }> };

/** A reel's narration is a minute of speech. Anything vastly larger is a mistake. */
const MAX_VO_BYTES = 100 * 1024 * 1024;

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
 * Stored unaligned, and the previous take's word timings are dropped with it.
 * They describe audio that no longer exists: leaving them behind let the build
 * skip alignment entirely and cut every beat on the old take's timings, which
 * is silent, plausible and wrong.
 */
export async function PUT(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'bad reel id' }, { status: 400 });

  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.length === 0) {
    return NextResponse.json({ error: 'no audio in the request body' }, { status: 400 });
  }
  if (bytes.length > MAX_VO_BYTES) {
    return NextResponse.json({ error: 'that voiceover is too large' }, { status: 413 });
  }

  const dest = reelVoFile(slug);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, bytes);

  const reel = await loadReel(slug);
  await saveReel(slug, { ...reel, vo: { ...reel.vo, words: [], durationSec: 0 } });

  return NextResponse.json({ ok: true, bytes: bytes.length });
}
