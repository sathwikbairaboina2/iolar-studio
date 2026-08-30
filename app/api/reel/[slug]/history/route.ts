import { NextResponse } from 'next/server';
import { publish } from '@/lib/reel/bus';
import * as history from '@/lib/reel/history';

type Ctx = { params: Promise<{ slug: string }> };

/** What was done to this reel, and by whom. */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  return NextResponse.json(await history.read(slug));
}

/**
 * Undo and redo move the cursor; they are not themselves commands and never
 * enter the log, which keeps it a record of intent rather than of navigation.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  if (action !== 'undo' && action !== 'redo') {
    return NextResponse.json({ error: 'action must be "undo" or "redo"' }, { status: 400 });
  }

  try {
    const { reel, cursor } = action === 'undo' ? await history.undo(slug) : await history.redo(slug);
    publish(slug, reel);
    return NextResponse.json({ reel, cursor });
  } catch (err) {
    const log = await history.read(slug).catch(() => ({ cursor: 0, entries: [] }));
    return NextResponse.json(
      { error: String(err instanceof Error ? err.message : err), cursor: log.cursor, length: log.entries.length },
      { status: 409 }
    );
  }
}
