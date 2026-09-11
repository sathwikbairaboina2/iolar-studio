import { NextResponse } from 'next/server';
import { COMMANDS, CommandError, applyCommand } from '@/lib/explainer/commands';
import { foldDoc } from '@/lib/explainer/schema';

/**
 * The one door every edit goes through, whoever is knocking.
 *
 * `actor` defaults to 'agent' because the studio always labels itself: anything that did not
 * bother to say is, by elimination, not the studio.
 */

type Ctx = { params: Promise<{ slug: string }> };

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
    const { doc, entry } = await applyCommand(slug, {
      op: body.op,
      args: body.args ?? {},
      actor: body.actor === 'ui' ? 'ui' : 'agent',
    });
    // The fold has already happened as a post-condition, so handing it back costs nothing and
    // saves the editor a round trip on every edit.
    const steps = foldDoc(doc).map((s) => ({
      id: s.beat.id, role: s.beat.role, startFrame: s.startFrame,
      durationFrames: s.durationFrames, mutations: s.beat.mutations.length, scene: s.scene,
    }));
    return NextResponse.json({ doc, entry, steps });
  } catch (err) {
    if (err instanceof CommandError) {
      return NextResponse.json({ error: err.message, ...err.detail }, { status: err.status });
    }
    throw err;
  }
}

export async function GET() {
  return NextResponse.json({ ops: Object.keys(COMMANDS) });
}
