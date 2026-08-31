import { NextResponse } from 'next/server';
import { applyCommand, CommandError } from '@/lib/reel/commands';
import type { Reel } from '@/lib/reel/schema';

type Ctx = { params: Promise<{ slug: string }> };
export const maxDuration = 300;

/**
 * Commits an approved proposal.
 *
 * Every command runs through the full write path again rather than trusting the
 * preview: generated assets land while a proposal sits on screen, so the reel can
 * have moved underneath it.
 *
 * A rejection stops the run instead of skipping past it, because step 5 of a
 * plan usually depends on step 2. What already landed stays landed — it is in
 * history and individually undoable — and the response says exactly how far it got.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  if (!Array.isArray(body?.commands) || body.commands.length === 0) {
    return NextResponse.json({ error: 'body must be {commands: [...]} with at least one command' }, { status: 400 });
  }

  const applied: { index: number; op: string; summary: string }[] = [];
  let reel: Reel | null = null;

  for (const [index, input] of body.commands.entries()) {
    try {
      const out = await applyCommand(slug, { op: input.op, args: input.args ?? {}, actor: 'agent' });
      reel = out.reel;
      applied.push({ index, op: input.op, summary: out.entry.summary });
    } catch (err) {
      const detail = err instanceof CommandError ? err.detail : {};
      const status = err instanceof CommandError ? err.status : 500;
      return NextResponse.json(
        {
          error: err instanceof Error ? err.message : String(err),
          applied,
          rejected: { index, op: input.op, error: err instanceof Error ? err.message : String(err), detail },
          notAttempted: body.commands.length - index - 1,
          reel,
        },
        { status: status === 500 ? 500 : 409 }
      );
    }
  }

  return NextResponse.json({ reel, applied });
}
