import { NextResponse } from 'next/server';
import * as store from '@/lib/reel/research/store';

type Ctx = { params: Promise<{ slug: string }> };

/**
 * The workflow's terminal gate.
 *
 * Refused for an uncited factual line — an assertion nothing in the pack backs
 * is the failure this whole pipeline exists to prevent, and marking a line as
 * commentary is the deliberate way past it.
 *
 * Not refused for an unsupported brief claim: the research did not find what
 * the brief hoped for, which is an answer about the topic rather than a defect,
 * and the call belongs to the user.
 */
export async function POST(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    const script = await store.readScript(slug);
    if (script.lines.length === 0) {
      return NextResponse.json({ error: 'nothing to approve: the script has no lines' }, { status: 409 });
    }

    const uncited = script.lines.filter((l) => !l.commentary && l.citations.length === 0).map((l) => l.id);
    if (uncited.length > 0) {
      return NextResponse.json(
        {
          error: `${uncited.length} line(s) assert something with no source. Cite them, or mark them as commentary.`,
          uncited,
        },
        { status: 409 }
      );
    }

    await store.writeScript(slug, { ...script, status: 'approved', updatedAt: new Date().toISOString() });
    await store.setResearchStatus(slug, 'approved');
    return NextResponse.json({ ok: true, status: 'approved', lines: script.lines.length });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}
