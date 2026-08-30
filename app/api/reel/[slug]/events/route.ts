import { subscribe } from '@/lib/reel/bus';
import type { Reel } from '@/lib/reel/schema';

type Ctx = { params: Promise<{ slug: string }> };

/** SSE has no timeout of its own; a long edit-free stretch would look like a hang. */
const HEARTBEAT_MS = 25_000;

/**
 * Pushes the reel to every open studio tab whenever it changes, so an agent's
 * edit appears without a refresh.
 *
 * The bus behind this is in-process — correct for a single local Next process,
 * and the thing to replace first if the studio ever runs multi-worker.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const encoder = new TextEncoder();

  let unsubscribe = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Client vanished between publish and enqueue; the cancel path cleans up.
        }
      };

      unsubscribe = subscribe(slug, (reel: Reel) => send(`data: ${JSON.stringify(reel)}\n\n`));
      heartbeat = setInterval(() => send(`: keep-alive\n\n`), HEARTBEAT_MS);

      req.signal?.addEventListener('abort', () => {
        unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      });
    },
    cancel() {
      unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
    },
  });
}
