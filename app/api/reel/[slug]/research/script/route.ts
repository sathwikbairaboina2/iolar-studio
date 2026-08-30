import { NextResponse } from 'next/server';
import * as store from '@/lib/reel/research/store';
import { parseScript, unsupportedClaims } from '@/lib/reel/research/script';

type Ctx = { params: Promise<{ slug: string }> };

/**
 * Saves the user's edits.
 *
 * `unsupported` is recomputed from what the lines now say rather than trusted
 * from the client: dropping the only line that made a claim has to surface
 * immediately, not at approval.
 */
export async function PUT(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    const current = await store.readScript(slug);
    if (current.status === 'approved') {
      return NextResponse.json({ error: 'this script is approved; reopen it before editing' }, { status: 409 });
    }

    const body = await req.json().catch(() => ({}));
    const brief = await store.readBrief(slug);
    const draft = parseScript({
      ...current,
      lines: body.lines ?? current.lines,
      updatedAt: new Date().toISOString(),
      unsupported: [],
    });
    const next = { ...draft, unsupported: unsupportedClaims(brief.mustProve, draft.lines) };

    await store.writeScript(slug, next);
    return NextResponse.json({ ok: true, unsupported: next.unsupported, updatedAt: next.updatedAt });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}
