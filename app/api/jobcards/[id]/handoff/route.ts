import { NextResponse } from 'next/server';
import { handoffCard } from '@/lib/jobcard/handoff';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Send the rendered card to IntaBot, which queues it for approval. A card that is not
 * complete (400) or not rendered (409) is not sent; IntaBot's own refusal comes back with
 * its status, and an IntaBot that does not answer is a 502.
 */
export async function POST(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const out = await handoffCard(id);
  const { status, ...body } = out;
  return NextResponse.json(body, { status });
}
