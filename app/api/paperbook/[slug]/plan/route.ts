import { NextResponse } from 'next/server';
import { planSlidesFromBook, densifySlides } from '@/lib/ai/plan';
import { ClaudeUnavailableError } from '@/lib/ai/claude';

type Ctx = { params: Promise<{ slug: string }> };

export const maxDuration = 900;

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  try {
    const body = await req.json().catch(() => ({}));

    if (body.mode === 'headings') {
      const { fixHeadings } = await import('@/lib/ai/headings');
      return NextResponse.json({ proposal: await fixHeadings(slug) });
    }

    if (body.mode === 'densify') {
      if (!Array.isArray(body.underfilled) || !body.underfilled.length) {
        return NextResponse.json({ error: 'underfilled slides required' }, { status: 400 });
      }
      // Proposal only — the client applies it after review.
      return NextResponse.json({ proposal: await densifySlides(slug, body.underfilled) });
    }

    // Default: generate slides from the approved book.
    return NextResponse.json(await planSlidesFromBook(slug));
  } catch (err) {
    if (err instanceof ClaudeUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
