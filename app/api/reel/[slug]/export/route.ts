import { NextResponse } from 'next/server';
import path from 'path';
import { serveMedia } from '@/lib/reel/serveMedia';
import { reelExportDir } from '@/lib/paths';

type Ctx = { params: Promise<{ slug: string }> };

/**
 * The finished cut, served back.
 *
 * The studio does not make it any more. The recordings, the voice and the script go to an
 * editor through the handoff route, and the cut comes back through it.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    return await serveMedia(path.join(reelExportDir(slug), 'reel.mp4'), req);
  } catch {
    return NextResponse.json({ error: 'not exported' }, { status: 404 });
  }
}
