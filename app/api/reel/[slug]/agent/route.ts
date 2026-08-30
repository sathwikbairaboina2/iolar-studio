import { NextResponse } from 'next/server';
import { CommandError, loadReelOr404 } from '@/lib/reel/commands';
import { previewCommands } from '@/lib/reel/preview';
import { getAgentBackend, AgentError } from '@/lib/ai/agent';

type Ctx = { params: Promise<{ slug: string }> };
export const maxDuration = 300;

/**
 * Turns a plain-English request into a reviewable proposal.
 *
 * The proposal is previewed here before it is returned, so the studio always
 * renders a plan that has already been checked against the real reel. Nothing
 * is written: this endpoint cannot change a reel.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  if (typeof body?.prompt !== 'string' || !body.prompt.trim()) {
    return NextResponse.json({ error: 'body must be {prompt}' }, { status: 400 });
  }

  const backend = getAgentBackend();
  try {
    const reel = await loadReelOr404(slug);
    const proposal = await backend.propose({ slug, reel, prompt: body.prompt.trim() });
    const preview = await previewCommands(slug, proposal.commands);

    return NextResponse.json({
      provider: backend.name,
      commands: proposal.commands,
      note: proposal.note,
      raw: proposal.commands.length ? undefined : proposal.raw,
      ...preview,
    });
  } catch (err) {
    if (err instanceof AgentError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof CommandError) {
      return NextResponse.json({ error: err.message, ...err.detail }, { status: err.status });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
