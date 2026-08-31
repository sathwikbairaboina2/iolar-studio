import { NextResponse } from 'next/server';
import * as store from '@/lib/reel/research/store';
import { parseScript, unsupportedClaims, unsupportedFromCoverage } from '@/lib/reel/research/script';
import { judgeCoverage } from '@/lib/reel/research/agents';

type Ctx = { params: Promise<{ slug: string }> };

/**
 * Saves the user's edits.
 *
 * `unsupported` is recomputed from what the lines now say rather than trusted
 * from the client: dropping the only line that made a claim has to surface
 * immediately, not at approval.
 *
 * Dropping a line is answered from the stored judgement, which is why the lines
 * that carry each claim are kept. Rewriting one is not — the text the judge read
 * is gone — so that alone re-runs it, and a failed re-run leaves the previous
 * answer standing rather than inventing a worse one.
 */
export const maxDuration = 300;
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
    const before = new Map(current.lines.map((l) => [l.id, l.text]));
    const rewritten = draft.lines.some((l) => before.has(l.id) && before.get(l.id) !== l.text);

    let coverage = current.coverage ?? [];
    if (rewritten) {
      try {
        coverage = await judgeCoverage(brief.mustProve, draft.lines);
      } catch {
        // Keep the judgement we have; a stale reading beats no reading.
      }
    }

    const unsupported = coverage.length
      ? unsupportedFromCoverage(brief.mustProve, coverage, draft.lines)
      : unsupportedClaims(brief.mustProve, draft.lines);
    const next = { ...draft, unsupported, coverage };

    await store.writeScript(slug, next);
    return NextResponse.json({ ok: true, unsupported: next.unsupported, updatedAt: next.updatedAt });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 400 });
  }
}
