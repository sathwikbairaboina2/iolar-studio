import { NextResponse } from 'next/server';
import * as store from '@/lib/reel/research/store';
import { parseSelection } from '@/lib/reel/research/selection';

type Ctx = { params: Promise<{ slug: string }> };

/**
 * The review gate. Keeping nothing is a decision the user is allowed to make,
 * but it leaves the script stage with no sources, so it is refused here rather
 * than failing three stages later.
 */
export async function PUT(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  try {
    const selection = parseSelection({
      runId: slug,
      updatedAt: new Date().toISOString(),
      decisions: body.decisions ?? {},
      fetchRequestedAt: null,
    });

    const kept = Object.values(selection.decisions).filter((d) => d.state === 'keep').length;
    if (kept === 0) {
      return NextResponse.json(
        { error: 'keep at least one source — the script can only cite what survives review' },
        { status: 409 }
      );
    }

    await store.writeSelection(slug, selection);
    await store.setResearchStatus(slug, 'reviewed');
    return NextResponse.json({ ok: true, kept, status: 'reviewed' });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}
