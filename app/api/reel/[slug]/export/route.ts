import { NextResponse } from 'next/server';
import { exportReel } from '@/lib/reel/ffmpeg';

type Ctx = { params: Promise<{ slug: string }> };
export const maxDuration = 900;

/** Streams encode progress so the studio can show a bar while the DOM preview stays usable. */
export async function POST(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      let last = -1;
      try {
        const out = await exportReel(slug, (pct) => {
          const rounded = Math.floor(pct * 100);
          if (rounded > last) {
            last = rounded;
            send({ pct: rounded / 100 });
          }
        });
        send({ done: true, path: 'export/reel.mp4', durationSec: out.durationSec });
      } catch (err) {
        send({ error: String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    },
  });
}

/** Serves the finished file back for playback or download. */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const path = await import('path');
  const { reelExportDir } = await import('@/lib/paths');
  const { serveMedia } = await import('@/lib/reel/serveMedia');
  try {
    return await serveMedia(path.join(reelExportDir(slug), 'reel.mp4'), req);
  } catch {
    return NextResponse.json({ error: 'not exported' }, { status: 404 });
  }
}
