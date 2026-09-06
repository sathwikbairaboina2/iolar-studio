import { NextResponse } from 'next/server';
import { planSlidesFromBook, densifySlides } from '@/lib/ai/plan';
import { planPagesFromBook } from '@/lib/ai/pages';
import { ClaudeUnavailableError } from '@/lib/ai/claude';

type Ctx = { params: Promise<{ subject: string; chapter: string; part: string }> };

export const maxDuration = 900;

export async function POST(req: Request, ctx: Ctx) {
  const { subject, chapter, part: partParam } = await ctx.params;
  const part = Number(partParam);
  try {
    const body = await req.json().catch(() => ({}));

    if (body.mode === 'fit') {
      const { fitToPages } = await import('@/lib/ai/fit');
      const { proposal, before } = await fitToPages(subject, chapter, part);
      return NextResponse.json({ proposal, before });
    }

    if (body.mode === 'headings') {
      const { fixHeadings } = await import('@/lib/ai/headings');
      return NextResponse.json({ proposal: await fixHeadings(subject, chapter, part) });
    }

    if (body.mode === 'densify') {
      if (!Array.isArray(body.underfilled) || !body.underfilled.length) {
        return NextResponse.json({ error: 'underfilled slides required' }, { status: 400 });
      }
      // Proposal only — the client applies it after review.
      return NextResponse.json({ proposal: await densifySlides(subject, chapter, part, body.underfilled) });
    }

    // Default: one prompt per chapter with a running summary. `mode: 'whole'` keeps the single-shot planner.
    if (body.mode === 'whole') return NextResponse.json(await planSlidesFromBook(subject, chapter, part));
    return NextResponse.json(await planPagesFromBook(subject, chapter, part));
  } catch (err) {
    if (err instanceof ClaudeUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
