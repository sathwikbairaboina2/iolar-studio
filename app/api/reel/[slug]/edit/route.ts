import { NextResponse } from 'next/server';
import { applyCommand, CommandError, COMMANDS } from '@/lib/reel/commands';

type Ctx = { params: Promise<{ slug: string }> };

/**
 * The one door every edit goes through, whoever is knocking.
 *
 * `actor` defaults to 'agent' because the studio always labels itself: anything
 * that did not bother to say is, by elimination, not the studio.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  if (typeof body?.op !== 'string') {
    return NextResponse.json(
      { error: 'body must be {op, args, actor?}', validOps: Object.keys(COMMANDS) },
      { status: 400 }
    );
  }

  try {
    const { reel, entry } = await applyCommand(slug, {
      op: body.op,
      args: body.args ?? {},
      actor: body.actor === 'ui' ? 'ui' : 'agent',
    });
    return NextResponse.json({ reel, entry });
  } catch (err) {
    if (err instanceof CommandError) {
      return NextResponse.json({ error: err.message, ...err.detail }, { status: err.status });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
