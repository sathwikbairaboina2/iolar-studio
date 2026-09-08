import { NextResponse } from 'next/server';
import { chapterGaps, repairCoverage } from '@/lib/ai/repair';
import { ClaudeUnavailableError } from '@/lib/ai/claude';

type Ctx = { params: Promise<{ subject: string; chapter: string }> };

export const maxDuration = 900;

/** Which book points the chapter's pages no longer cover. */
export async function GET(_req: Request, ctx: Ctx) {
  const { subject, chapter } = await ctx.params;
  try {
    const missing = await chapterGaps(subject, chapter);
    return NextResponse.json({ missing, complete: missing.length === 0 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/** Appends pages that teach the missing points. Rejects anything that is not purely additive. */
export async function POST(_req: Request, ctx: Ctx) {
  const { subject, chapter } = await ctx.params;
  try {
    const repair = await repairCoverage(subject, chapter);
    return NextResponse.json({ repair });
  } catch (err) {
    if (err instanceof ClaudeUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
