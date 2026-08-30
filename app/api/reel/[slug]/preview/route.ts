import { NextResponse } from 'next/server';
import { CommandError } from '@/lib/reel/commands';
import { previewCommands } from '@/lib/reel/preview';

type Ctx = { params: Promise<{ slug: string }> };

/**
 * "What would this plan do?" — for the studio's diff, and for the agent service
 * checking its own work before proposing it.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  if (!Array.isArray(body?.commands)) {
    return NextResponse.json({ error: 'body must be {commands: [{op, args}, ...]}' }, { status: 400 });
  }

  try {
    const out = await previewCommands(
      slug,
      body.commands.map((c: { op: string; args?: unknown }) => ({ op: c.op, args: c.args ?? {}, actor: 'agent' as const }))
    );
    return NextResponse.json(out);
  } catch (err) {
    if (err instanceof CommandError) {
      return NextResponse.json({ error: err.message, ...err.detail }, { status: err.status });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
