import { NextResponse } from 'next/server';
import { reviewPart, loadReview, reviewIsCurrent, reviewPassed } from '@/lib/verify/review';
import { runGates } from '@/lib/verify/runGates';
import { ClaudeUnavailableError } from '@/lib/ai/claude';

type Ctx = { params: Promise<{ subject: string; chapter: string; part: string }> };

export const maxDuration = 900;

export async function GET(_req: Request, ctx: Ctx) {
  const { subject, chapter, part } = await ctx.params;
  const n = Number(part);
  return NextResponse.json({
    review: await loadReview(subject, chapter, n),
    current: await reviewIsCurrent(subject, chapter, n),
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const { subject, chapter, part } = await ctx.params;
  const n = Number(part);
  try {
    const body = await req.json().catch(() => ({}));
    // Gates only: deterministic, fast, no AI — useful as a pre-flight before a full review.
    if (body.mode === 'gates') {
      const findings = await runGates(subject, chapter, n);
      return NextResponse.json({
        review: { generatedAt: new Date().toISOString(), part: n, findings, passed: reviewPassed(findings) },
        current: true,
      });
    }
    return NextResponse.json({ review: await reviewPart(subject, chapter, n), current: true });
  } catch (err) {
    if (err instanceof ClaudeUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
